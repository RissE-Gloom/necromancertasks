class FirebaseService {
    constructor() {
        this.isInitialized = false;
        this.init();
    }

    async init() {
        try {
            // Динамически загружаем Firebase SDK
            await this.loadFirebaseSDK();
            
            // Конфигурация Firebase (замени на свои ключи)
            const firebaseConfig = {
              apiKey: process.env.FIREBASE_API_KEY,
              authDomain: process.env.FIREBASE_AUTH_DOMAIN,
              projectId: process.env.FIREBASE_PROJECT_ID,
              storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
              messagingSenderId: process.env.FIREBASE_MESSAGINGSENDERID,
              appId: process.env.FIREBASE_APPID
          };
            
            this.app = window.firebase.initializeApp(firebaseConfig);
            this.db = window.firebase.database();
            this.isInitialized = true;
            
            console.log('✅ Firebase initialized successfully');
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

    // ... остальные методы (saveTasks, loadTasks и т.д.) остаются без изменений
}

export default FirebaseService;
