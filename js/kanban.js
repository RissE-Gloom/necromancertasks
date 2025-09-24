// Core Kanban Board Application
class KanbanBoard {
  constructor() {
    this.tasks = this.loadTasks()
    this.columns = this.loadColumns()
    this.currentEditingColumn = null
    this.lucide = window.lucide
    this.draggedTask = null
    this.draggedElement = null
    this.ws = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.syncPending = false;
    this.pendingSyncRequests = new Map();
    this.clientType = 'browser'; // 👈 Добавляем тип клиента

    this.init()
  }

  setupWebSocket() {
    try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsPort = window.location.hostname === 'localhost' ? ':8080' : '';
        const isMiniApp = window.Telegram?.WebApp?.initData || window.location.search.includes('miniApp=true');
        
        // 👇 Добавляем параметр для идентификации типа клиента
        const wsUrl = `${wsProtocol}//${window.location.hostname}${wsPort}?clientType=${isMiniApp ? 'miniApp' : 'browser'}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('✅ Connected to bot server');
            this.retryCount = 0;
            this.ws.send(JSON.stringify({ type: 'PING' }));
            
            // 👇 Если это Mini App, запрашиваем синхронизацию при подключении
            if (isMiniApp) {
                this.requestSync();
            }
        };

        // 👇 Улучшаем обработчик сообщений
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('📨 Received from server:', message.type);
                
                // Обрабатываем сообщения синхронизации
                switch (message.type) {
                    case 'SYNC_DATA':
                        this.handleSyncData(message);
                        break;
                    case 'SYNC_REQUESTED':
                        if (!isMiniApp) { // 👇 Только браузер обрабатывает запросы синхронизации
                            this.handleSyncRequested(message);
                        }
                        break;
                    case 'SYNC_CONFIRMED':
                        this.handleSyncConfirmed(message);
                        break;
                    case 'CONNECTION_ESTABLISHED':
                        console.log('✅ Connection confirmed by server');
                        if (message.clientType) {
                            this.clientType = message.clientType;
                        }
                        break;
                    case 'TASK_MOVED':
                    case 'TASK_CREATED':
                    case 'TASK_UPDATED':
                    case 'TASK_DELETED':
                        if (isMiniApp) { // 👇 Mini App обрабатывает изменения от браузера
                            this.handleChangeNotification(message);
                        }
                        break;
                    default:
                        this.handleBotMessage(event.data);
                        break;
                }
            } catch (error) {
                console.error('Message processing error:', error);
                this.handleBotMessage(event.data);
            }
        };

        this.ws.onclose = () => {
            console.log('❌ WebSocket disconnected');
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

    } catch (error) {
        console.error('WebSocket setup error:', error);
    }
  }

  // 👇 Улучшенный обработчик синхронизации
  handleSyncData(message) {
    if (message.tasks && message.columns) {
        console.log('🔄 Receiving sync data');
        
        // Сохраняем полученные данные
        this.tasks = message.tasks;
        this.columns = message.columns;
        
        this.saveTasks();
        this.saveColumns();
        this.render();
        
        // Подтверждаем получение (только если это не исходило от нас)
        if (message.syncId && !this.pendingSyncRequests.has(message.syncId)) {
            this.sendToBot({
                type: 'SYNC_CONFIRMED',
                syncId: message.syncId,
                timestamp: new Date().toISOString()
            });
        }
    }
  }

  handleSyncRequested(message) {
    console.log('📬 Sync requested by Mini App');
    
    // Отправляем текущее состояние
    this.sendSyncData(message.requestId);
  }

  handleSyncConfirmed(message) {
    if (this.pendingSyncRequests.has(message.syncId)) {
        console.log('✅ Sync confirmed:', message.syncId);
        this.pendingSyncRequests.delete(message.syncId);
        this.syncPending = false;
        
        // Обновляем UI если нужно
        this.updateSyncButton(false);
    }
  }

  // 👇 Новый метод для обработки уведомлений об изменениях
  handleChangeNotification(message) {
    console.log('📝 Processing change notification:', message.type);
    
    switch (message.type) {
        case 'TASK_MOVED':
            this.applyTaskMove(message);
            break;
        case 'TASK_CREATED':
            this.applyTaskCreate(message);
            break;
        case 'TASK_UPDATED':
            this.applyTaskUpdate(message);
            break;
        case 'TASK_DELETED':
            this.applyTaskDelete(message);
            break;
    }
  }

  applyTaskMove(message) {
    const task = this.tasks.find(t => t.id === message.taskId);
    if (task && task.status !== message.toStatus) {
        task.status = message.toStatus;
        this.saveTasks();
        this.render();
    }
  }

  applyTaskCreate(message) {
    const existingTask = this.tasks.find(t => t.id === message.task.id);
    if (!existingTask) {
        this.tasks.push({
            ...message.task,
            createdAt: message.timestamp,
            description: message.task.description || '',
            label: message.task.label || ''
        });
        this.saveTasks();
        this.render();
    }
  }

  applyTaskUpdate(message) {
    const taskIndex = this.tasks.findIndex(t => t.id === message.taskId);
    if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...message.updatedData };
        this.saveTasks();
        this.render();
    }
  }

  applyTaskDelete(message) {
    this.tasks = this.tasks.filter(t => t.id !== message.taskId);
    this.saveTasks();
    this.render();
  }

  sendSyncData(requestId = null) {
    const syncData = {
        type: 'SYNC_DATA',
        syncId: this.generateId(),
        tasks: this.tasks,
        columns: this.columns,
        timestamp: new Date().toISOString()
    };
    
    if (requestId) {
        syncData.requestId = requestId;
    }
    
    this.sendToBot(syncData);
  }

  requestSync() {
    const requestId = this.generateId();
    this.pendingSyncRequests.set(requestId, {
        timestamp: Date.now(),
        status: 'pending'
    });
    
    this.updateSyncButton(true);
    
    this.sendToBot({
        type: 'REQUEST_SYNC',
        requestId: requestId,
        timestamp: new Date().toISOString()
    });
    
    // Таймаут на ответ
    setTimeout(() => {
        if (this.pendingSyncRequests.has(requestId)) {
            console.log('⏰ Sync request timeout');
            this.pendingSyncRequests.delete(requestId);
            this.updateSyncButton(false);
        }
    }, 5000);
  }

  updateSyncButton(isSyncing) {
    const syncButton = document.getElementById('sync-btn');
    if (syncButton) {
        if (isSyncing) {
            syncButton.innerHTML = '<i data-lucide="loader" class="spin"></i> Синхронизация...';
            syncButton.disabled = true;
        } else {
            syncButton.innerHTML = '<i data-lucide="refresh-cw"></i> Синхронизировать';
            syncButton.disabled = false;
        }
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
  }

  // 👇 Модифицируем методы для отправки изменений вместо полной синхронизации
  addTask(taskData) {
    const task = {
        id: this.generateId(),
        title: taskData.title,
        description: taskData.description,
        status: taskData.status,
        priority: taskData.priority,
        label: taskData.label || '',
        createdAt: new Date().toISOString(),
    };

    this.tasks.push(task);
    this.saveTasks();
    
    // Отправляем уведомление о создании
    this.sendToBot({
        type: 'TASK_CREATED',
        taskId: task.id,
        status: task.status,
        timestamp: task.createdAt,
        task: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            label: task.label
        }
    });
    
    this.render();
  }

  deleteTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        this.saveTasks();
        
        // Отправляем уведомление об удалении
        this.sendToBot({
            type: 'TASK_DELETED',
            taskId: taskId,
            timestamp: new Date().toISOString()
        });
        
        this.render();
    }
  }

  updateTaskStatus(taskId, newStatus) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    task.status = newStatus;
    this.saveTasks();
    this.render();

    // Отправляем уведомление о перемещении
    if (oldStatus !== newStatus) {
        this.trackTaskMovement(taskId, oldStatus, newStatus);
    }
  }

  // 👇 Модифицируем handleEditTask для отправки изменений
  handleEditTask(e) {
    const formData = new FormData(e.target);
    const taskId = formData.get("id");
    const updatedData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status")
    };

    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
        const oldTask = { ...this.tasks[taskIndex] };
        this.tasks[taskIndex] = { ...oldTask, ...updatedData };
        this.saveTasks();
        
        // Отправляем уведомление об обновлении
        this.sendToBot({
            type: 'TASK_UPDATED',
            taskId: taskId,
            updatedData: updatedData,
            timestamp: new Date().toISOString()
        });
        
        this.render();
        this.closeModal("edit-task-modal");
    }
  }

  // 👇 Добавляем обработку изменений колонок
  addColumn(title) {
    const status = title.toLowerCase().replace(/\s+/g, "-");
    const column = {
      id: status,
      title: title,
      status: status,
    };

    this.columns.push(column);
    this.saveColumns();
    this.render();
    
    // Полная синхронизация при изменении структуры колонок
    this.sendSyncData();
  }

  updateColumnTitle(status, newTitle) {
    const column = this.columns.find((c) => c.status === status);
    if (column) {
      column.title = newTitle;
      this.saveColumns();
      this.render();
      
      // Полная синхронизация при изменении структуры колонок
      this.sendSyncData();
    }
  }

  deleteColumn(status) {
    if (this.columns.length <= 1) return;

    // Move tasks from deleted column to first available column
    const tasksInColumn = this.getTasksByStatus(status);
    if (tasksInColumn.length > 0) {
      const remainingColumns = this.columns.filter((c) => c.status !== status);
      const targetStatus = remainingColumns[0].status;

      tasksInColumn.forEach((task) => {
        task.status = targetStatus;
      });
      this.saveTasks();
    }

    this.columns = this.columns.filter((c) => c.status !== status);
    this.saveColumns();
    this.render();
    
    // Полная синхронизация при изменении структуры колонок
    this.sendSyncData();
  }

  // 👇 Улучшаем trackTaskMovement для более детальной информации
  trackTaskMovement(taskId, fromStatus, toStatus) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    const activity = {
        type: 'TASK_MOVED',
        taskId,
        fromStatus,
        toStatus,
        timestamp: new Date().toISOString(),
        task: {
            id: task.id,
            title: task.title,
            priority: task.priority,
            label: task.label || '',
            description: task.description || ''
        }
    };
    
    console.log('🔄 Tracking task movement:', activity);
    this.sendToBot(activity);
  }

  // 👇 Модифицируем handleEditTask для синхронизации
  handleEditTask(e) {
    const formData = new FormData(e.target)
    const taskId = formData.get("id")
    const updatedData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status")
    }

    const taskIndex = this.tasks.findIndex(t => t.id === taskId)
    if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updatedData }
        this.saveTasks()
        
        // 👇 Синхронизация после редактирования задачи
        this.sendSyncData();
        this.render()
        this.closeModal("edit-task-modal")
    }
  }

  // Остальной код остается без изменений...
  // ... [все остальные методы остаются как есть] ...

}

// Initialize the application
let kanban
document.addEventListener("DOMContentLoaded", () => {
  kanban = new KanbanBoard()
  
  // 👇 Добавляем кнопку синхронизации в интерфейс, если её нет
  if (!document.getElementById('sync-btn')) {
    const syncButton = document.createElement('button');
    syncButton.id = 'sync-btn';
    syncButton.className = 'btn sync-btn';
    syncButton.innerHTML = '<i data-lucide="refresh-cw"></i> Синхронизировать';
    syncButton.style.position = 'fixed';
    syncButton.style.bottom = '20px';
    syncButton.style.right = '20px';
    syncButton.style.zIndex = '1000';
    syncButton.onclick = () => kanban.requestSync();
    
    document.body.appendChild(syncButton);
    
    // Инициализируем иконку после рендера
    setTimeout(() => {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }, 100);
  }
});
