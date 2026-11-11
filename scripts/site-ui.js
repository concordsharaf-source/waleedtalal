(() => {
    'use strict';

    const excludedButtonSelectors = [
        '.hamburger-btn',
        '.faq-floating-btn',
        '.faq-q',
        '.whatsapp-float',
        '.close-btn',
        '[aria-label="القائمة"]',
        '[aria-label="إغلاق"]'
    ].join(',');

    function unifySiteButtons() {
        // جميع أزرار الإجراءات في الصفحات العامة، مع استثناء أزرار القوائم والإغلاق والعناصر العائمة.
        document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach(button => {
            if (!button.matches(excludedButtonSelectors)) {
                button.classList.add('site-3d-btn');
            }
        });

        const actionLinkSelectors = [
            '.btn-main',
            '.btn-action',
            '.btn-apply',
            '.donate-now-btn',
            '.read-more',
            '.submit-whatsapp-btn',
            'a.btn',
            'a.button',
            'a.cta',
            '[role="button"]'
        ].join(',');

        document.querySelectorAll(actionLinkSelectors).forEach(link => {
            if (!link.matches(excludedButtonSelectors)) {
                link.classList.add('site-3d-btn');
            }
        });
    }

    function createHeaderActions() {
        const actions = document.createElement('nav');
        actions.className = 'site-header-actions';
        actions.setAttribute('aria-label', 'خدمات المؤسسة السريعة');

        const insidePages = window.location.pathname.includes('/pages/');
        const requestUrl = insidePages ? 'us.html' : 'pages/us.html';
        const trackUrl = insidePages ? 'track.html' : 'pages/track.html';
        const chatUrl = insidePages ? 'chat.html' : 'pages/chat.html';
        const statisticsUrl = insidePages ? '../index.html#statistics' : '#statistics';

        const links = [
            {
                text: 'تقديم طلب مساعدة',
                href: requestUrl
            },
            {
                text: 'تتبع معاملتك',
                href: trackUrl
            },
            {
                text: 'المحادثة المباشرة مع الإدارة',
                href: chatUrl,
                pulse: true
            },
            {
                text: 'موقع الأمير الوليد بن طلال',
                href: 'https://waleed-bin-talal-website.vercel.app/ar/',
                external: true
            },
            {
                text: 'إحصائياتنا',
                href: statisticsUrl
            },
            {
                text: 'تواصل مع الشكاوى',
                href: 'https://wa.me/966578129244',
                external: true,
                complaints: true
            }
        ];

        links.forEach(item => {
            const link = document.createElement('a');
            link.className = `site-header-action site-3d-btn${item.pulse ? ' site-wa-pulse' : ''}${item.complaints ? ' site-complaints-action' : ''}`;
            link.href = item.href;
            link.textContent = item.text;
            if (item.complaints) link.dataset.complaintsContact = 'true';

            if (item.external) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }

            actions.appendChild(link);
        });

        return actions;
    }

    function addHeaderActions() {
        // إذا كانت مجموعة الخدمات موجودة بالفعل (كما في الرئيسية) فلا نكررها.
        if (document.querySelector('.site-header-actions')) {
            return;
        }

        const actions = createHeaderActions();
        const heroHost = document.querySelector('.about-hero, .hero-banner, section.hero');
        const directHeader = document.querySelector('body > header');

        // نضع الأزرار في مسار الصفحة بعد الهيرو أو الهيدر، وليس فوق النصوص والصور.
        // بهذه الطريقة لا يمكن أن تغطي العناوين، خصوصاً على شاشات الجوال الصغيرة.
        const standalone = document.createElement('section');
        standalone.className = 'site-actions-standalone';
        standalone.setAttribute('aria-label', 'روابط الخدمات السريعة');
        standalone.appendChild(actions);
        document.body.classList.add('site-actions-standalone-page');

        const placementAnchor = heroHost || directHeader;

        if (placementAnchor) {
            placementAnchor.insertAdjacentElement('afterend', standalone);
        } else {
            document.body.classList.add('site-actions-no-header-page');
            document.body.insertAdjacentElement('afterbegin', standalone);
        }
    }

    function manageContinuousAnimations() {
        const animatedElements = document.querySelectorAll(
            '.continuous-scroll, .site-wa-pulse, .btn-wa-pulse'
        );

        if (!animatedElements.length) return;

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                entry.target.style.animationPlayState =
                    entry.isIntersecting && !document.hidden ? 'running' : 'paused';
            });
        }, { threshold: 0.01 });

        animatedElements.forEach(element => observer.observe(element));

        document.addEventListener('visibilitychange', () => {
            animatedElements.forEach(element => {
                if (document.hidden) {
                    element.style.animationPlayState = 'paused';
                    return;
                }

                const rect = element.getBoundingClientRect();
                const isVisible = rect.bottom > 0 && rect.top < window.innerHeight;
                element.style.animationPlayState = isVisible ? 'running' : 'paused';
            });
        });
    }

    function initializeUnifiedUi() {
        addHeaderActions();
        unifySiteButtons();
        manageContinuousAnimations();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUnifiedUi, { once: true });
    } else {
        initializeUnifiedUi();
    }
})();
