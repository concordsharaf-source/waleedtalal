/* معلومات الجهاز المشتركة لصفحة التسجيل وصفحة تتبع المعاملة. */

function cleanDeviceValue(value, maxLength = 120) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maxLength);
}

export function deviceModelFromUserAgent(userAgent) {
    const androidBuild = userAgent.match(/Android[^;)]*;\s*([^;)]+?)\s+Build\//i);
    if (androidBuild && !/^(K|wv)$/i.test(androidBuild[1].trim())) {
        return cleanDeviceValue(androidBuild[1]);
    }
    if (/iphone/i.test(userAgent)) return 'iPhone';
    if (/ipad/i.test(userAgent)) return 'iPad';
    if (/ipod/i.test(userAgent)) return 'iPod';
    return '';
}

export function friendlyDeviceModel(model) {
    const raw = cleanDeviceValue(model);
    const code = raw.toUpperCase();
    const knownModels = [
        [/^SM-S938/, 'Galaxy S25 Ultra'], [/^SM-S936/, 'Galaxy S25+'], [/^SM-S931/, 'Galaxy S25'],
        [/^SM-S928/, 'Galaxy S24 Ultra'], [/^SM-S926/, 'Galaxy S24+'], [/^SM-S921/, 'Galaxy S24'],
        [/^SM-S918/, 'Galaxy S23 Ultra'], [/^SM-S916/, 'Galaxy S23+'], [/^SM-S911/, 'Galaxy S23'],
        [/^SM-S908/, 'Galaxy S22 Ultra'], [/^SM-S906/, 'Galaxy S22+'], [/^SM-S901/, 'Galaxy S22'],
        [/^SM-F956/, 'Galaxy Z Fold6'], [/^SM-F741/, 'Galaxy Z Flip6'],
        [/^SM-F946/, 'Galaxy Z Fold5'], [/^SM-F731/, 'Galaxy Z Flip5']
    ];
    const match = knownModels.find(([pattern]) => pattern.test(code));
    return match ? `${match[1]} (${raw})` : raw;
}

export function deviceBrandFromModel(model, userAgent) {
    const source = `${model} ${userAgent}`.toLowerCase();
    if (/\b(sm-|gt-|samsung)/i.test(`${model} ${userAgent}`)) return 'Samsung';
    if (/\bpixel\b/.test(source)) return 'Google';
    if (/huawei|\b(ele|vog|noh|lio|ana|jny)-/i.test(source)) return 'Huawei';
    if (/honor/i.test(source)) return 'Honor';
    if (/redmi|poco|xiaomi|\bmi\s/i.test(source)) return 'Xiaomi';
    if (/oneplus/i.test(source)) return 'OnePlus';
    if (/oppo|\bcph\d/i.test(source)) return 'OPPO';
    if (/realme|\brmx\d/i.test(source)) return 'realme';
    if (/vivo/i.test(source)) return 'vivo';
    if (/motorola|\bmoto\b/i.test(source)) return 'Motorola';
    if (/tecno/i.test(source)) return 'TECNO';
    if (/infinix/i.test(source)) return 'Infinix';
    if (/iphone|ipad|ipod/i.test(source)) return 'Apple';
    return '';
}

export async function getDeviceDetails() {
    const userAgent = String(navigator.userAgent || '');
    let hints = {};
    try {
        if (navigator.userAgentData?.getHighEntropyValues) {
            hints = await navigator.userAgentData.getHighEntropyValues([
                'model', 'platform', 'platformVersion', 'architecture', 'bitness', 'mobile'
            ]);
        }
    } catch (error) {
        console.warn('تعذر قراءة معلومات موديل الجهاز', error);
    }

    let device = 'كمبيوتر';
    const tablet = /ipad|tablet|playbook|silk/i.test(userAgent) ||
        (/android/i.test(userAgent) && !/mobi/i.test(userAgent));
    const mobile = hints.mobile === true || /mobi|android|iphone|ipod/i.test(userAgent);
    if (tablet) device = 'جهاز لوحي';
    else if (mobile) device = 'جوال';

    let browser = 'متصفح غير معروف';
    if (/edg\//i.test(userAgent)) browser = 'Microsoft Edge';
    else if (/opr\//i.test(userAgent)) browser = 'Opera';
    else if (/samsungbrowser\//i.test(userAgent)) browser = 'Samsung Internet';
    else if (/firefox|fxios/i.test(userAgent)) browser = 'Firefox';
    else if (/chrome|crios/i.test(userAgent)) browser = 'Google Chrome';
    else if (/safari/i.test(userAgent)) browser = 'Safari';

    const hintedPlatform = cleanDeviceValue(hints.platform, 40);
    const hintedPlatformVersion = cleanDeviceValue(hints.platformVersion, 40);
    const androidVersion = userAgent.match(/Android\s+([0-9.]+)/i)?.[1] || '';
    const iosVersion = userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS)\s+([0-9_]+)/i)?.[1]?.replace(/_/g, '.') || '';
    let os = 'نظام غير معروف';
    if (hintedPlatform) os = hintedPlatform + (hintedPlatformVersion ? ` ${hintedPlatformVersion}` : '');
    else if (/windows nt/i.test(userAgent)) os = 'Windows';
    else if (/android/i.test(userAgent)) os = `Android${androidVersion ? ` ${androidVersion}` : ''}`;
    else if (/iphone|ipad|ipod/i.test(userAgent)) os = `iOS${iosVersion ? ` ${iosVersion}` : ''}`;
    else if (/mac os x/i.test(userAgent)) os = 'macOS';
    else if (/linux/i.test(userAgent)) os = 'Linux';

    const rawDeviceModel = cleanDeviceValue(hints.model) || deviceModelFromUserAgent(userAgent);
    const deviceBrand = deviceBrandFromModel(rawDeviceModel, userAgent);
    const deviceModel = friendlyDeviceModel(rawDeviceModel);
    const architecture = cleanDeviceValue([
        hints.architecture || '',
        hints.bitness ? `${hints.bitness}-bit` : ''
    ].filter(Boolean).join(' '), 40);

    return {
        device,
        deviceBrand,
        deviceModel,
        browser,
        os,
        architecture,
        language: String(navigator.language || 'غير معروف').slice(0, 20),
        screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
        userAgent: userAgent.slice(0, 500)
    };
}
