// firebase-service.js
class FirebaseService {
    constructor() {
        this.isInitialized = false;
        this.firebaseConfig = {
            apiKey: "FIREBASE_API_KEY",
            authDomain: "FIREBASE_AUTH_DOMAIN",
            projectId: "FIREBASE_PROJECT_ID",
            storageBucket: "FIREBASE_STORAGE_BUCKET",
            messagingSenderId: "FIREBASE_MESSAGINGSENDERID",
            appId: "FIREBASE_APPID"
        }; 
        this.init();
    }

    async init() {
        try {
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
            console.error('❌ Firebase init failed:', error);
        }
    }
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
        }
    }

    loadFirebaseSDK() {
        return new Promise((resolve, reject) => {
            if (window.firebase) {
                resolve();
                return;
            }

            // Загружаем Firebase SDK динамически
            const script = document.createElement('script');
            script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
            script.onload = () => {
                const scriptDatabase = document.createElement('script');
                scriptDatabase.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js';
                scriptDatabase.onload = resolve;
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

    async updateTimestamp() {
        if (!this.isInitialized) return;
        
        try {
            await this.db.ref('projects/default/lastUpdated').set(new Date().toISOString());
        } catch (error) {
            console.error('Error updating timestamp:', error);
        }
    }

    // Реaltime синхронизация
    setupRealtimeSync(onDataChange) {
        if (!this.isInitialized) return;

        this.db.ref('projects/default').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && onDataChange) {
                onDataChange(data.tasks || {}, data.columns || {});
            }
        });
    }
}

export default FirebaseService;
