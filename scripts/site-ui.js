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
                text: 'تطبيق الواتس الخاص بالمؤسسة',
                href: 'https://messenger-gamma-five.vercel.app/index.html',
                external: true,
                pulse: true
            },
            {
                text: 'موقع الأمير الوليد بن طلال',
                href: 'https://waleed-bin-talal-website.vercel.app/ar/',
                external: true
            }
        ];

        links.forEach(item => {
            const link = document.createElement('a');
            link.className = `site-header-action site-3d-btn${item.pulse ? ' site-wa-pulse' : ''}`;
            link.href = item.href;
            link.textContent = item.text;

            if (item.external) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }

            actions.appendChild(link);
        });

        return actions;
    }

    function addHeaderActions() {
        // الصفحة الرئيسية تحتوي على المجموعة الأصلية بالفعل، فلا نكررها.
        if (document.querySelector('.hero-content .btn-main') || document.querySelector('.site-header-actions')) {
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

    function initializeUnifiedUi() {
        addHeaderActions();
        unifySiteButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUnifiedUi, { once: true });
    } else {
        initializeUnifiedUi();
    }
})();
