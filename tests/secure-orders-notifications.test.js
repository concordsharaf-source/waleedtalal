const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const Module = require('module');

const securePage = fs.readFileSync('pages/orders-view-secure.html', 'utf8');
const ownerAdminPage = fs.readFileSync('pages/admon.html', 'utf8');
const notificationPage = fs.readFileSync('pages/notifications.html', 'utf8');
const registerApi = fs.readFileSync('api/register-order.js', 'utf8');
const trackingApi = fs.readFileSync('api/track-attempt.js', 'utf8');
const notificationsApi = fs.readFileSync('api/admin-notifications.js', 'utf8');
const notificationDeviceApi = fs.readFileSync('api/admin-notification-device.js', 'utf8');
const notificationServer = fs.readFileSync('server/admin-notifications.js', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');

assert(securePage.includes('إشعارات التسجيل والتتبع'), 'secure viewer should contain the notification center');
assert(securePage.includes('id="ordersPage"'), 'secure viewer should keep orders on the main page');
assert(securePage.includes('id="notificationsSubpage" hidden'), 'notifications should start on a separate hidden subpage');
assert(securePage.includes('orders-view-secure.html?view=notifications'), 'main page should link to the notification subpage');
assert(securePage.indexOf('id="viewerPushPanel"') < securePage.indexOf('class="secure-notifications-link"'), 'per-device push control should appear above the notification-subpage link');
assert(securePage.includes('getBrowserPushToken'), 'secure viewer should acquire a browser push token');
assert(securePage.includes('/api/admin-notification-device'), 'secure viewer should register and unregister its notification device');
assert(securePage.includes('const first = confirm(') && securePage.includes('const second = confirm('), 'disabling push should require two confirmations');
assert(securePage.includes('.viewer-push-toggle.enabled .viewer-bell::after'), 'enabled push button should show a diagonal slash');
assert(securePage.includes('.viewer-push-toggle:not(.enabled) .viewer-bell'), 'disabled push bell should pulse');
assert(securePage.includes('secureNotificationBadge.hidden = unreadCount === 0'), 'main-page notification badge should follow unread state');
assert(securePage.includes('tracking.textContent = "معلومات التتبع"'), 'every order notification should offer a tracking-information button');
assert(securePage.includes('const params = new URLSearchParams({ transactionId, phone })'), 'tracking-information links should include transaction and phone credentials');
assert(securePage.includes('return `status.html?${params.toString()}`'), 'tracking-information button should open the normal status page');
assert(securePage.includes('phone: item?.details?.applicantPhone'), 'registration notification links should fall back to their saved mobile number');
assert(securePage.includes('if (item.unread) await markNotificationRead(item.id)'), 'opening tracking information should mark the notification read first');
assert(securePage.includes('trackingButton.textContent = "معلومات التتبع"'), 'secure user-information cards should offer the same tracking button');
assert(securePage.includes('trackingStatusUrlForOrder(order)'), 'secure user-information cards should use the order transaction and registered phone');
assert(ownerAdminPage.includes('📋 معلومات التتبع'), 'owner user-information cards should offer a tracking button');
assert(ownerAdminPage.includes('window.openTrackingInfo=function(id)'), 'owner user-information tracking button should resolve the selected order');
assert(ownerAdminPage.includes('window.location.assign("status.html?"+params.toString())'), 'owner user-information tracking button should open the status page');
assert(securePage.includes('onSnapshot(collection(db, "orders")'), 'orders should update in real time');
assert(securePage.includes('/api/admin-notifications?limit=200'), 'secure viewer should load persistent owner notifications');
assert(securePage.includes('Authorization: `Bearer ${token}`'), 'secure viewer should authenticate notification requests with Firebase');
assert(securePage.includes('appendRegistrationDeviceDetails(grid, order)'), 'registration device details should be rendered');
assert(securePage.includes('createDeviceFacts(log || {})'), 'tracking device details should be rendered');
[
  'نوع الجهاز', 'الشركة', 'الموديل', 'نظام التشغيل',
  'المتصفح', 'المعمارية', 'اللغة', 'أبعاد الشاشة'
].forEach(label => assert(securePage.includes(label), `missing device field: ${label}`));

assert(registerApi.includes('orders-view-secure.html?notification=registration'), 'registration pushes should open the secure viewer');
assert(trackingApi.includes('orders-view-secure.html?notification=tracking'), 'tracking pushes should open the secure viewer');
assert(notificationPage.includes('return`orders-view-secure.html?${params.toString()}`'), 'notification-center actions should open the secure viewer');
assert(trackingApi.includes('details: {\n                device,'), 'tracking notifications should persist device details');
assert(registerApi.includes('language: registrationDevice.language'), 'registration notifications should include language');
assert(trackingApi.includes('language: logEntry.language'), 'tracking notifications should include language');
assert(notificationServer.includes('language: 20'), 'notification detail sanitizer should allow language');
assert(notificationsApi.includes("getAuth().verifyIdToken"), 'notification API should verify Firebase ID tokens');
assert(notificationsApi.includes("token.uid === ALLOWED_VIEWER_UID"), 'notification API should restrict the secure viewer UID');
assert(notificationsApi.includes("'language', 'screen'"), 'notification API should return language and screen details');
assert(notificationDeviceApi.includes('getAuth().verifyIdToken'), 'notification-device API should verify Firebase ID tokens');
assert(notificationDeviceApi.includes('token.uid === ALLOWED_VIEWER_UID'), 'notification-device API should restrict the secure viewer UID');
['deviceBrand', 'deviceModel', 'architecture', 'language', 'screen'].forEach(field => {
  assert(notificationDeviceApi.includes(`${field}: clean(body.${field}`), `notification-device API should persist ${field}`);
});
assert(serviceWorker.includes('waleedtalal-pwa-v64'));
assert(serviceWorker.includes('"./pages/orders-view-secure.html"'), 'secure viewer should be cached in the app shell');

const deviceSource = fs.readFileSync('scripts/device-info.js', 'utf8').replace(/\bexport\s+/g, '');
const deviceContext = vm.createContext({console:{warn(){}}, String, Array, RegExp});
vm.runInContext(deviceSource, deviceContext, {filename:'device-info.js'});
assert.equal(deviceContext.friendlyDeviceModel('SM-S928B'), 'Galaxy S24 Ultra (SM-S928B)');
assert.equal(deviceContext.deviceBrandFromModel('SM-S928B', ''), 'Samsung');
assert.equal(deviceContext.deviceModelFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A)'), 'SM-S928B');

(async () => {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain){
    if(request === 'firebase-admin/app') return {
      getApps:() => [{}], initializeApp(){}, cert(value){ return value; }
    };
    if(request === 'firebase-admin/auth') return {
      getAuth:() => ({
        async verifyIdToken(token){
          if(token !== 'valid-viewer-token') throw new Error('invalid-token');
          return {uid:'8Ni42RlbrGTtgepNdSso3li8nD62', email:'admin@admin.com'};
        }
      })
    };
    if(request === 'firebase-admin/firestore') return {
      FieldValue:{serverTimestamp:() => 'timestamp'},
      getFirestore:() => ({
        collection:() => ({
          orderBy:() => ({limit:() => ({async get(){ return {docs:[]}; }})})
        })
      })
    };
    if(request === '../server/admin-auth') return {isAdminRequest:() => false};
    return originalLoad.call(this, request, parent, isMain);
  };

  let handler;
  try {
    delete require.cache[require.resolve('../api/admin-notifications.js')];
    handler = require('../api/admin-notifications.js');
  } finally {
    Module._load = originalLoad;
  }

  function responseRecorder(){
    return {
      code:0,
      body:null,
      headers:{},
      setHeader(name,value){ this.headers[name] = value; },
      status(code){ this.code = code; return this; },
      json(body){ this.body = body; return this; }
    };
  }

  const allowedResponse = responseRecorder();
  await handler({method:'GET', headers:{authorization:'Bearer valid-viewer-token'}, query:{}}, allowedResponse);
  assert.equal(allowedResponse.code, 200, 'valid secure viewer token should load notifications');
  assert.deepEqual(allowedResponse.body.notifications, []);

  const deniedResponse = responseRecorder();
  await handler({method:'GET', headers:{authorization:'Bearer invalid-token'}, query:{}}, deniedResponse);
  assert.equal(deniedResponse.code, 401, 'invalid viewer token must be rejected');

  let savedDevice = null;
  Module._load = function(request, parent, isMain){
    if(request === 'firebase-admin/app') return {
      getApps:() => [{}], initializeApp(){}, cert(value){ return value; }
    };
    if(request === 'firebase-admin/auth') return {
      getAuth:() => ({
        async verifyIdToken(token){
          if(token !== 'valid-viewer-token') throw new Error('invalid-token');
          return {uid:'8Ni42RlbrGTtgepNdSso3li8nD62', email:'admin@admin.com'};
        }
      })
    };
    if(request === 'firebase-admin/firestore') return {
      FieldValue:{serverTimestamp:() => 'timestamp'},
      getFirestore:() => ({
        collection:() => ({
          doc:() => ({
            async set(value){ savedDevice = value; },
            async delete(){ savedDevice = null; }
          })
        })
      })
    };
    if(request === '../server/admin-auth') return {isAdminRequest:() => false};
    return originalLoad.call(this, request, parent, isMain);
  };

  let deviceHandler;
  try {
    delete require.cache[require.resolve('../api/admin-notification-device.js')];
    deviceHandler = require('../api/admin-notification-device.js');
  } finally {
    Module._load = originalLoad;
  }

  const deviceResponse = responseRecorder();
  await deviceHandler({
    method:'POST',
    headers:{authorization:'Bearer valid-viewer-token'},
    body:{
      action:'register',
      deviceId:'owner_secure_device_123',
      token:'x'.repeat(80),
      device:'جوال',
      deviceBrand:'Samsung',
      deviceModel:'Galaxy S24 Ultra (SM-S928B)',
      browser:'Google Chrome',
      os:'Android 14',
      architecture:'arm 64-bit',
      language:'ar-SA',
      screen:'1440x3120'
    }
  }, deviceResponse);
  assert.equal(deviceResponse.code, 200, 'valid secure viewer token should register a notification device');
  assert.equal(savedDevice.deviceBrand, 'Samsung');
  assert.equal(savedDevice.deviceModel, 'Galaxy S24 Ultra (SM-S928B)');
  assert.equal(savedDevice.architecture, 'arm 64-bit');
  assert.equal(savedDevice.language, 'ar-SA');
  assert.equal(savedDevice.screen, '1440x3120');

  const deniedDeviceResponse = responseRecorder();
  await deviceHandler({
    method:'POST',
    headers:{authorization:'Bearer invalid-token'},
    body:{action:'unregister', deviceId:'owner_secure_device_123'}
  }, deniedDeviceResponse);
  assert.equal(deniedDeviceResponse.code, 401, 'invalid viewer token must not change notification devices');

  console.log('secure orders notification and device tests passed');
})();
