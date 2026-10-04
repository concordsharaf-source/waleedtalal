(() => {
    'use strict';

    const scriptUrl = document.currentScript && document.currentScript.src
        ? new URL(document.currentScript.src)
        : new URL('scripts/pwa.js', window.location.href);
    const serviceWorkerUrl = new URL('../sw.js', scriptUrl);
    const serviceWorkerScope = new URL('../', scriptUrl).pathname;

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                const registration = await navigator.serviceWorker.register(serviceWorkerUrl.href, {
                    scope: serviceWorkerScope
                });

                if (!registration) return;

                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }

                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing;
                    if (!worker) return;

                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                            worker.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                });
            } catch (error) {
                console.error('تعذر تسجيل تطبيق الموقع:', error);
            }
        });
    }

    let deferredInstallPrompt = null;
    let installButton = null;

    function isRunningStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
    }

    function removeInstallButton() {
        if (installButton) {
            installButton.remove();
            installButton = null;
        }
    }

    function showInstallButton() {
        if (!deferredInstallPrompt || isRunningStandalone() || installButton) return;
        // صفحة المحادثة توفر زر تثبيت صغيراً خاصاً بتطبيق المحادثة.
        if (document.getElementById('installChatAppButton')) return;

        installButton = document.createElement('button');
        installButton.type = 'button';
        installButton.className = 'site-3d-btn pwa-install-btn';
        installButton.textContent = 'تثبيت التطبيق';
        installButton.setAttribute('aria-label', 'تثبيت الموقع كتطبيق على الجهاز');

        installButton.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;

            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            removeInstallButton();
        });

        // زر عائم خارج مسار التخطيط حتى لا يغيّر ارتفاع الصفحة عند ظهوره المتأخر.
        document.body.appendChild(installButton);
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        showInstallButton();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        removeInstallButton();
    });

    function showConnectionStatus(message, online) {
        let status = document.getElementById('pwaConnectionStatus');

        if (!status) {
            status = document.createElement('div');
            status.id = 'pwaConnectionStatus';
            status.className = 'pwa-connection-status';
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            document.body.appendChild(status);
        }

        status.textContent = message;
        status.classList.toggle('is-online', online);
        status.classList.add('show');

        window.setTimeout(() => status.classList.remove('show'), 3000);
    }

    window.addEventListener('offline', () => {
        showConnectionStatus('أنت الآن دون اتصال — ستظهر الصفحات المحفوظة.', false);
    });

    window.addEventListener('online', () => {
        showConnectionStatus('عاد الاتصال بالإنترنت.', true);
    });
})();
