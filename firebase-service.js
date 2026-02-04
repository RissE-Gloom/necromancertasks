// firebase-service.js
class FirebaseService {
    constructor() {
        this.isInitialized = false;
        this.isSyncing = false;
        this.firebaseConfig = {
            apiKey: "AIzaSyAqnTZXQDuCF3QqxhOhwTRXCulDaLO_iUI",
            authDomain: "berloga-lisy.firebaseapp.com",
            databaseURL: "https://berloga-lisy-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "berloga-lisy",
            storageBucket: "berloga-lisy.firebasestorage.app",
            messagingSenderId: "266173768415",
            appId: "1:266173768415:web:46e245024336974a7c3f6a"
        };

        // Создаем промис для отслеживания инициализации
        this.initializationPromise = this.init();
    }

    async init() {
        try {
            await this.loadFirebaseSDK();

            // Проверяем, загружен ли Firebase
            if (typeof firebase === 'undefined') {
                console.error('Firebase not loaded');
                return;
            }

            this.app = firebase.initializeApp(this.firebaseConfig);
            this.db = firebase.database();
            this.isInitialized = true;
            console.log('✅ Firebase initialized');
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            this.isInitialized = false; // Явно указываем
        }
    }

    // Helper to wait for init
    async waitForInitialization() {
        await this.initializationPromise;
        return this.isInitialized;
    }

    setupGlobalHandlers() {
        // Вешаем обработчики на document
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="edit-column"]')) {
                const status = e.target.closest('button').dataset.status;
                this.openEditColumnModal(status, '');
            }
            // ... другие обработчики
        });
    }

    loadFirebaseSDK() {
        return new Promise((resolve, reject) => {
            if (window.firebase) {
                resolve();
                return;
            }

            console.log('🔄 Loading Firebase SDK...');
            const script = document.createElement('script');
            script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js'; //compat версия
            script.onload = () => {
                const scriptDatabase = document.createElement('script');
                scriptDatabase.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js'; //и здесь compat
                scriptDatabase.onload = () => {
                    console.log('✅ Firebase SDK loaded');
                    resolve();
                };
                scriptDatabase.onerror = reject;
                document.head.appendChild(scriptDatabase);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Методы для работы с данными...
    async saveTasks(tasks) {
        if (!this.isInitialized) {
            console.warn('Firebase not initialized');
            return false;
        }

        try {
            const tasksObj = {};
            tasks.forEach(task => {
                tasksObj[task.id] = task;
            });

            await this.db.ref(`projects/default/tasks`).set(tasksObj);
            await this.updateTimestamp();
            return true;
        } catch (error) {
            console.error('Error saving tasks:', error);
            return false;
        }
    }

    async loadTasks() {
        return new Promise((resolve) => {
            if (!this.isInitialized) {
                resolve([]);
                return;
            }

            this.db.ref('projects/default/tasks').once('value')
                .then(snapshot => {
                    const data = snapshot.val();
                    const tasks = data ? Object.values(data) : [];
                    resolve(tasks);
                })
                .catch(error => {
                    console.error('Error loading tasks:', error);
                    resolve([]);
                });
        });
    }

    async saveColumns(columns) {
        if (!this.isInitialized) {
            console.warn('Firebase not initialized');
            return false;
        }

        try {
            const columnsObj = {};
            columns.forEach(column => {
                columnsObj[column.id] = column;
            });

            await this.db.ref(`projects/default/columns`).set(columnsObj);
            await this.updateTimestamp();
            return true;
        } catch (error) {
            console.error('Error saving columns:', error);
            return false;
        }
    }

    async loadColumns() {
        return new Promise((resolve) => {
            if (!this.isInitialized) {
                resolve([]);
                return;
            }

            this.db.ref('projects/default/columns').once('value')
                .then(snapshot => {
                    const data = snapshot.val();
                    const columns = data ? Object.values(data) : [];
                    resolve(columns);
                })
                .catch(error => {
                    console.error('Error loading columns:', error);
                    resolve([]);
                });
        });
    }

    async saveLabels(labels) {
        if (!this.isInitialized) return false;
        try {
            await this.db.ref(`projects/default/labels`).set(labels);
            await this.updateTimestamp();
            return true;
        } catch (error) {
            console.error('Error saving labels:', error);
            return false;
        }
    }

    async loadLabels() {
        return new Promise((resolve) => {
            if (!this.isInitialized) {
                resolve([]);
                return;
            }

            this.db.ref('projects/default/labels').once('value')
                .then(snapshot => {
                    const data = snapshot.val();
                    resolve(Array.isArray(data) ? data : []);
                })
                .catch(error => {
                    console.error('Error loading labels:', error);
                    resolve([]);
                });
        });
    }

    async updateTimestamp() {
        if (!this.isInitialized) return;

        try {
            await this.db.ref('projects/default/lastUpdated').set(new Date().toISOString());
        } catch (error) {
            console.error('Error updating timestamp:', error);
        }
    }

    async manualSync() {
        if (!this.isInitialized) return;

        console.log('🔄 Manual sync started');
        this.isSyncing = true;

        try {
            // Загружаем свежие данные из Firebase
            const [tasks, columns, labels] = await Promise.all([
                this.loadTasks(),
                this.loadColumns(),
                this.loadLabels()
            ]);

            console.log('✅ Manual sync completed');
            return { tasks, columns, labels };

        } catch (error) {
            console.error('❌ Manual sync failed:', error);
            return null;
        } finally {
            this.isSyncing = false;
        }
    }

    // Реaltime синхронизация
    setupRealtimeSync(onDataChange) {
        if (!this.isInitialized) return;

        //флаг чтобы избежать циклических обновлений
        this.isSyncing = false;

        this.db.ref('projects/default').on('value', (snapshot) => {
            // Игнорируем синхронизацию если это ответ на наш же запрос
            if (this.isSyncing) {
                this.isSyncing = false;
                return;
            }

            const data = snapshot.val();
            if (data && onDataChange) {
                console.log('🔄 Firebase realtime update received');
                onDataChange(data.tasks || {}, data.columns || {}, data.labels || []);
            }
        });
    }
}

export default FirebaseService;
