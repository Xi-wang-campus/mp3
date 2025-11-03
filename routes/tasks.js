var Task = require('../models/task');
var User = require('../models/user');

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

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

        // Parse limit parameter (default 100 for tasks)
        if (req.query.limit) {
            options.limit = parseInt(req.query.limit);
            if (isNaN(options.limit)) {
                return { error: 'Invalid limit parameter' };
            }
        } else {
            options.limit = 100; // Default limit for tasks
        }

        // Parse count parameter
        var count = req.query.count === 'true';

        return { query: query, options: options, count: count };
    }

    // GET /api/tasks - Get all tasks with optional query parameters
    tasksRoute.get(function (req, res) {
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
            Task.countDocuments(query)
                .then(function (count) {
                    res.status(200).json({
                        message: 'OK',
                        data: count
                    });
                })
                .catch(function (err) {
                    res.status(500).json({
                        message: 'Server error while counting tasks',
                        data: null
                    });
                });
        } else {
            Task.find(query, null, options)
                .then(function (tasks) {
                    res.status(200).json({
                        message: 'OK',
                        data: tasks
                    });
                })
                .catch(function (err) {
                    res.status(500).json({
                        message: 'Server error while retrieving tasks',
                        data: null
                    });
                });
        }
    });

    // POST /api/tasks - Create a new task
    tasksRoute.post(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: 'Task must have a name and deadline',
                data: null
            });
        }

        var assignedUser = req.body.assignedUser || '';
        var assignedUserName = req.body.assignedUserName || 'unassigned';

        // If assignedUser is provided, fetch the user's name
        var namePromise = Promise.resolve();
        if (assignedUser && assignedUser !== '') {
            namePromise = User.findById(assignedUser)
                .then(function (user) {
                    if (user) {
                        assignedUserName = user.name;
                    }
                })
                .catch(function () {
                    // Use provided name or default
                    assignedUserName = req.body.assignedUserName || 'unassigned';
                });
        }

        namePromise.then(function () {
            // Set defaults
            // Handle deadline: could be number (timestamp) or string
            var deadlineValue = req.body.deadline;
            if (typeof deadlineValue === 'string' && !isNaN(deadlineValue)) {
                deadlineValue = parseInt(deadlineValue);
            }
            var deadline = new Date(deadlineValue);

            var taskData = {
                name: req.body.name,
                description: req.body.description || '',
                deadline: deadline,
                completed: req.body.completed !== undefined ? (req.body.completed === true || req.body.completed === 'true') : false,
                assignedUser: assignedUser,
                assignedUserName: assignedUserName,
                dateCreated: req.body.dateCreated ? new Date(req.body.dateCreated) : new Date()
            };

            var task = new Task(taskData);
            return task.save();
        }).then(function (newTask) {
            // If task is assigned and not completed, add it to user's pendingTasks
            if (newTask.assignedUser && !newTask.completed) {
                User.findById(newTask.assignedUser)
                    .then(function (user) {
                        if (user) {
                            var pendingTasks = user.pendingTasks || [];
                            if (pendingTasks.indexOf(newTask._id.toString()) === -1) {
                                pendingTasks.push(newTask._id.toString());
                                user.pendingTasks = pendingTasks;
                                user.save();
                            }
                        }
                    })
                    .catch(function (err) {
                        // Continue even if user update fails
                    });
            }

            res.status(201).json({
                message: 'Task created successfully',
                data: newTask
            });
        })
        .catch(function (err) {
            console.error('Error creating task:', err);
            res.status(500).json({
                message: 'Server error while creating task: ' + err.message,
                data: null
            });
        });
    });

    // GET /api/tasks/:id - Get a specific task
    taskRoute.get(function (req, res) {
        var query = Task.findById(req.params.id);

        // Parse select parameter for single task
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
            .then(function (task) {
                if (!task) {
                    return res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                }
                res.status(200).json({
                    message: 'OK',
                    data: task
                });
            })
            .catch(function (err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while retrieving task',
                        data: null
                    });
                }
            });
    });

    // PUT /api/tasks/:id - Update an entire task
    taskRoute.put(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: 'Task must have a name and deadline',
                data: null
            });
        }

        Task.findById(req.params.id)
            .then(function (task) {
                if (!task) {
                    return res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                }

                // Store old values for two-way reference update
                var oldAssignedUser = task.assignedUser;
                var oldCompleted = task.completed;
                var taskId = task._id.toString();

                // Update task fields
                task.name = req.body.name;
                task.description = req.body.description !== undefined ? req.body.description : task.description;
                
                // Handle deadline: could be number (timestamp) or string
                var deadlineValue = req.body.deadline;
                if (typeof deadlineValue === 'string' && !isNaN(deadlineValue)) {
                    deadlineValue = parseInt(deadlineValue);
                }
                task.deadline = new Date(deadlineValue);
                
                task.completed = req.body.completed !== undefined ? (req.body.completed === true || req.body.completed === 'true') : task.completed;
                task.assignedUser = req.body.assignedUser !== undefined ? req.body.assignedUser : task.assignedUser;
                task.dateCreated = req.body.dateCreated ? new Date(req.body.dateCreated) : task.dateCreated;

                // Handle assignedUserName: if assignedUser is provided, fetch the user's name
                var assignedUserNamePromise = Promise.resolve();
                if (req.body.assignedUser !== undefined) {
                    if (req.body.assignedUser && req.body.assignedUser !== '') {
                        assignedUserNamePromise = User.findById(req.body.assignedUser)
                            .then(function (user) {
                                if (user) {
                                    task.assignedUserName = user.name;
                                } else {
                                    task.assignedUserName = req.body.assignedUserName || 'unassigned';
                                }
                            })
                            .catch(function () {
                                task.assignedUserName = req.body.assignedUserName || 'unassigned';
                            });
                    } else {
                        task.assignedUserName = 'unassigned';
                    }
                } else if (req.body.assignedUserName !== undefined) {
                    task.assignedUserName = req.body.assignedUserName;
                }

                return assignedUserNamePromise.then(function () {
                    return task.save();
                }).then(function (updatedTask) {
                    var newAssignedUser = updatedTask.assignedUser;
                    var newCompleted = updatedTask.completed;

                    // Handle two-way reference updates
                    var promises = [];

                    // If assigned user changed, update both users
                    if (oldAssignedUser !== newAssignedUser) {
                        // Remove task from old user's pendingTasks if it was there
                        if (oldAssignedUser) {
                            promises.push(
                                User.findById(oldAssignedUser).then(function (oldUser) {
                                    if (oldUser) {
                                        var pendingTasks = oldUser.pendingTasks || [];
                                        var index = pendingTasks.indexOf(taskId);
                                        if (index !== -1) {
                                            pendingTasks.splice(index, 1);
                                            oldUser.pendingTasks = pendingTasks;
                                            return oldUser.save();
                                        }
                                    }
                                })
                            );
                        }

                        // Add task to new user's pendingTasks if not completed
                        if (newAssignedUser && !newCompleted) {
                            promises.push(
                                User.findById(newAssignedUser).then(function (newUser) {
                                    if (newUser) {
                                        var pendingTasks = newUser.pendingTasks || [];
                                        if (pendingTasks.indexOf(taskId) === -1) {
                                            pendingTasks.push(taskId);
                                            newUser.pendingTasks = pendingTasks;
                                            return newUser.save();
                                        }
                                    }
                                })
                            );
                        }

                        // If task became unassigned, update assignedUserName
                        if (!newAssignedUser) {
                            updatedTask.assignedUserName = 'unassigned';
                            promises.push(updatedTask.save());
                        }
                    }

                    // If completion status changed
                    if (oldCompleted !== newCompleted) {
                        if (newCompleted && newAssignedUser) {
                            // Task completed: remove from user's pendingTasks
                            promises.push(
                                User.findById(newAssignedUser).then(function (user) {
                                    if (user) {
                                        var pendingTasks = user.pendingTasks || [];
                                        var index = pendingTasks.indexOf(taskId);
                                        if (index !== -1) {
                                            pendingTasks.splice(index, 1);
                                            user.pendingTasks = pendingTasks;
                                            return user.save();
                                        }
                                    }
                                })
                            );
                        } else if (!newCompleted && newAssignedUser) {
                            // Task uncompleted: add to user's pendingTasks
                            promises.push(
                                User.findById(newAssignedUser).then(function (user) {
                                    if (user) {
                                        var pendingTasks = user.pendingTasks || [];
                                        if (pendingTasks.indexOf(taskId) === -1) {
                                            pendingTasks.push(taskId);
                                            user.pendingTasks = pendingTasks;
                                            return user.save();
                                        }
                                    }
                                })
                            );
                        }
                    }

                    // Wait for all updates to complete
                    return Promise.all(promises).then(function () {
                        // Refresh task to get latest data
                        return Task.findById(updatedTask._id);
                    });
                }).then(function (finalTask) {
                    res.status(200).json({
                        message: 'Task updated successfully',
                        data: finalTask
                    });
                });
            })
            .catch(function (err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while updating task',
                        data: null
                    });
                }
            });
    });

    // DELETE /api/tasks/:id - Delete a task
    taskRoute.delete(function (req, res) {
        Task.findById(req.params.id)
            .then(function (task) {
                if (!task) {
                    return res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                }

                var taskId = task._id.toString();
                var assignedUser = task.assignedUser;

                // Remove task from user's pendingTasks
                if (assignedUser) {
                    User.findById(assignedUser)
                        .then(function (user) {
                            if (user) {
                                var pendingTasks = user.pendingTasks || [];
                                var index = pendingTasks.indexOf(taskId);
                                if (index !== -1) {
                                    pendingTasks.splice(index, 1);
                                    user.pendingTasks = pendingTasks;
                                    user.save();
                                }
                            }
                        })
                        .catch(function (err) {
                            // Continue even if user update fails
                        });
                }

                return task.remove().then(function () {
                    res.status(204).send();
                });
            })
            .catch(function (err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Server error while deleting task',
                        data: null
                    });
                }
            });
    });

    return router;
};

