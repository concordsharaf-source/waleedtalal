'use strict';

function clean(value, maxLength = 120) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maxLength);
}

function cleanClientHint(value, maxLength = 120) {
    const text = clean(Array.isArray(value) ? value[0] : value, maxLength + 2);
    return text.replace(/^"|"$/g, '').replace(/\\"/g, '"').slice(0, maxLength);
}

function friendlyDeviceModel(model) {
    const raw = clean(model, 120);
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

function deviceModelFromUserAgent(userAgent) {
    const androidBuild = String(userAgent || '').match(/Android[^;)]*;\s*([^;)]+?)\s+Build\//i);
    if (androidBuild && !/^(K|wv)$/i.test(androidBuild[1].trim())) return androidBuild[1].trim();
    if (/iphone/i.test(userAgent)) return 'iPhone';
    if (/ipad/i.test(userAgent)) return 'iPad';
    if (/ipod/i.test(userAgent)) return 'iPod';
    return '';
}

function deviceBrandFromModel(model, userAgent) {
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

function browserFromUserAgent(userAgent) {
    if (/edg\//i.test(userAgent)) return 'Microsoft Edge';
    if (/opr\//i.test(userAgent)) return 'Opera';
    if (/samsungbrowser\//i.test(userAgent)) return 'Samsung Internet';
    if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
    if (/chrome|crios/i.test(userAgent)) return 'Google Chrome';
    if (/safari/i.test(userAgent)) return 'Safari';
    return 'متصفح غير معروف';
}

function extractDeviceInfo(request, body = {}) {
    const headers = request?.headers || {};
    const userAgent = clean(body.userAgent || headers['user-agent'], 500);
    const hintedModel = cleanClientHint(headers['sec-ch-ua-model'], 120);
    const rawDeviceModel = clean(body.deviceModel, 120) || hintedModel || deviceModelFromUserAgent(userAgent);
    const deviceModel = friendlyDeviceModel(rawDeviceModel);
    const deviceBrand = clean(body.deviceBrand, 80) || deviceBrandFromModel(rawDeviceModel, userAgent);
    const hintedPlatform = cleanClientHint(headers['sec-ch-ua-platform'], 40);
    const hintedPlatformVersion = cleanClientHint(headers['sec-ch-ua-platform-version'], 40);
    const hintedOs = [hintedPlatform, hintedPlatformVersion].filter(Boolean).join(' ');
    const os = hintedPlatformVersion ? hintedOs : (clean(body.os, 80) || hintedPlatform || 'غير معروف');
    const hintedArchitecture = [
        cleanClientHint(headers['sec-ch-ua-arch'], 20),
        cleanClientHint(headers['sec-ch-ua-bitness'], 10)
    ].filter(Boolean).join(' ');
    const architecture = clean(body.architecture, 40) || hintedArchitecture;
    const mobileHint = cleanClientHint(headers['sec-ch-ua-mobile'], 5);
    const bodyDevice = clean(body.device, 80);
    const tablet = /ipad|tablet|playbook|silk/i.test(userAgent) ||
        (/android/i.test(userAgent) && !/mobi/i.test(userAgent));
    const device = bodyDevice || (tablet ? 'جهاز لوحي' : mobileHint === '?1' || /mobi|android|iphone|ipod/i.test(userAgent) ? 'جوال' : 'كمبيوتر');

    return {
        device,
        deviceBrand,
        deviceModel,
        browser: clean(body.browser, 80) || browserFromUserAgent(userAgent),
        os,
        architecture,
        language: clean(body.language, 20) || 'غير معروف',
        screen: clean(body.screen, 30) || 'غير معروف',
        userAgent
    };
}

function describeDevice(deviceInfo = {}) {
    const model = [deviceInfo.deviceBrand, deviceInfo.deviceModel].filter(Boolean).join(' ');
    return [deviceInfo.device || 'جهاز غير معروف', model || 'الموديل محجوب من المتصفح']
        .filter(Boolean)
        .join(' — ');
}

module.exports = { describeDevice, extractDeviceInfo };
