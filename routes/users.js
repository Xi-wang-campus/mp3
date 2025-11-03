var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (router) {
    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    // Helper function to parse query parameters
    function parseQuery(req) {
        var query = {};
        var options = {};

        // Parse where parameter (also support 'filter' for compatibility with db scripts)
        if (req.query.where) {
            try {
                query = JSON.parse(req.query.where);
            } catch (e) {
                return { error: 'Invalid where parameter: ' + e.message };
            }
        } else if (req.query.filter) {
            try {
                query = JSON.parse(req.query.filter);
            } catch (e) {
                return { error: 'Invalid filter parameter: ' + e.message };
            }
        }

        // Parse sort parameter
        if (req.query.sort) {
            try {
                options.sort = JSON.parse(req.query.sort);
            } catch (e) {
                return { error: 'Invalid sort parameter: ' + e.message };
            }
        }

        // Parse select parameter
        if (req.query.select) {
            try {
                options.select = JSON.parse(req.query.select);
            } catch (e) {
                return { error: 'Invalid select parameter: ' + e.message };
            }
        }

        // Parse skip parameter
        if (req.query.skip) {
            options.skip = parseInt(req.query.skip);
            if (isNaN(options.skip)) {
                return { error: 'Invalid skip parameter' };
            }
        }

        // Parse limit parameter (unlimited for users by default)
        if (req.query.limit) {
            options.limit = parseInt(req.query.limit);
            if (isNaN(options.limit)) {
                return { error: 'Invalid limit parameter' };
            }
        }

        // Parse count parameter
        var count = req.query.count === 'true';

        return { query: query, options: options, count: count };
    }

    // GET /api/users - Get all users with optional query parameters
    usersRoute.get(function (req, res) {
        var parsed = parseQuery(req);
        if (parsed.error) {
            return res.status(400).json({
                message: parsed.error,
                data: null
            });
        }

        var query = parsed.query;
        var options = parsed.options;
        var count = parsed.count;

        if (count) {
            User.countDocuments(query)
                .then(function (count) {
                    res.status(200).json({
                        message: 'OK',
                        data: count
                    });
                })
                .catch(function (err) {
                    res.status(500).json({
                        message: 'Server error while counting users',
                        data: null
                    });
                });
        } else {
            User.find(query, null, options)
                .then(function (users) {
                    res.status(200).json({
                        message: 'OK',
                        data: users
                    });
                })
                .catch(function (err) {
                    res.status(500).json({
                        message: 'Server error while retrieving users',
                        data: null
                    });
                });
        }
    });

    // POST /api/users - Create a new user
    usersRoute.post(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: 'User must have a name and email',
                data: null
            });
        }

        // Set defaults
        var userData = {
            name: req.body.name,
            email: req.body.email,
            pendingTasks: req.body.pendingTasks || [],
            dateCreated: req.body.dateCreated || new Date()
        };

        var user = new User(userData);
        user.save()
            .then(function (newUser) {
                res.status(201).json({
                    message: 'User created successfully',
                    data: newUser
                });
            })
            .catch(function (err) {
                if (err.code === 11000) {
                    res.status(400).json({
                        message: 'User with this email already exists',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while creating user',
                        data: null
                    });
                }
            });
    });

    // GET /api/users/:id - Get a specific user
    userRoute.get(function (req, res) {
        var query = User.findById(req.params.id);

        // Parse select parameter for single user
        if (req.query.select) {
            try {
                var selectObj = JSON.parse(req.query.select);
                query = query.select(selectObj);
            } catch (e) {
                return res.status(400).json({
                    message: 'Invalid select parameter: ' + e.message,
                    data: null
                });
            }
        }

        query.exec()
            .then(function (user) {
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                }
                res.status(200).json({
                    message: 'OK',
                    data: user
                });
            })
            .catch(function (err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while retrieving user',
                        data: null
                    });
                }
            });
    });

    // PUT /api/users/:id - Update an entire user
    userRoute.put(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: 'User must have a name and email',
                data: null
            });
        }

        User.findById(req.params.id)
            .then(function (user) {
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                }

                // Get old pendingTasks for comparison
                var oldPendingTasks = user.pendingTasks || [];

                // Update user fields
                user.name = req.body.name;
                user.email = req.body.email;
                user.pendingTasks = req.body.pendingTasks !== undefined ? req.body.pendingTasks : user.pendingTasks;
                user.dateCreated = req.body.dateCreated || user.dateCreated;

                return user.save().then(function (updatedUser) {
                    // Handle two-way reference: update tasks' assignedUser and assignedUserName
                    var newPendingTasks = updatedUser.pendingTasks || [];
                    
                    // Convert string IDs to ObjectIds for comparison
                    var oldPendingTasksSet = {};
                    oldPendingTasks.forEach(function (id) {
                        oldPendingTasksSet[id] = true;
                    });
                    
                    var newPendingTasksSet = {};
                    newPendingTasks.forEach(function (id) {
                        newPendingTasksSet[id] = true;
                    });

                    // Find tasks that were in oldPendingTasks but not in new pendingTasks
                    var tasksToUnassign = oldPendingTasks.filter(function (taskId) {
                        return !newPendingTasksSet[taskId];
                    });
                    
                    // Find tasks that are in newPendingTasks but not in oldPendingTasks
                    var tasksToAssign = newPendingTasks.filter(function (taskId) {
                        return !oldPendingTasksSet[taskId];
                    });

                    var promises = [];

                    // Unassign tasks that were removed
                    if (tasksToUnassign.length > 0) {
                        promises.push(
                            Task.updateMany(
                                { _id: { $in: tasksToUnassign } },
                                { assignedUser: '', assignedUserName: 'unassigned' }
                            ).exec()
                        );
                    }

                    // Assign tasks that were added and update all tasks in newPendingTasks
                    if (tasksToAssign.length > 0 || newPendingTasks.length > 0) {
                        // Update tasks to assign (new ones)
                        if (tasksToAssign.length > 0) {
                            promises.push(
                                Task.updateMany(
                                    { _id: { $in: tasksToAssign } },
                                    { assignedUser: updatedUser._id.toString(), assignedUserName: updatedUser.name }
                                ).exec()
                            );
                        }
                        
                        // Update assignedUserName for all tasks in newPendingTasks (in case user name changed)
                        promises.push(
                            Task.updateMany(
                                { _id: { $in: newPendingTasks } },
                                { assignedUserName: updatedUser.name }
                            ).exec()
                        );
                    }

                    return Promise.all(promises).then(function () {
                        return updatedUser;
                    });
                }).then(function (updatedUser) {
                    res.status(200).json({
                        message: 'User updated successfully',
                        data: updatedUser
                    });
                });
            })
            .catch(function (err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                } else if (err.code === 11000) {
                    res.status(400).json({
                        message: 'User with this email already exists',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while updating user',
                        data: null
                    });
                }
            });
    });

    // DELETE /api/users/:id - Delete a user
    userRoute.delete(function (req, res) {
        User.findById(req.params.id)
            .then(function (user) {
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                }

                var userId = user._id.toString();
                var pendingTasks = user.pendingTasks || [];

                // Unassign all tasks assigned to this user
                if (pendingTasks.length > 0) {
                    Task.updateMany(
                        { _id: { $in: pendingTasks } },
                        { assignedUser: '', assignedUserName: 'unassigned' }
                    ).exec();
                }

                return user.remove().then(function () {
                    res.status(204).send();
                });
            })
            .catch(function (err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while deleting user',
                        data: null
                    });
                }
            });
    });

    return router;
};

