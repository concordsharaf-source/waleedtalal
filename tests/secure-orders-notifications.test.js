const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const Module = require('module');

const securePage = fs.readFileSync('pages/orders-view-secure.html', 'utf8');
const notificationPage = fs.readFileSync('pages/notifications.html', 'utf8');
const registerApi = fs.readFileSync('api/register-order.js', 'utf8');
const trackingApi = fs.readFileSync('api/track-attempt.js', 'utf8');
const notificationsApi = fs.readFileSync('api/admin-notifications.js', 'utf8');
const notificationServer = fs.readFileSync('server/admin-notifications.js', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');

assert(securePage.includes('إشعارات التسجيل والتتبع'), 'secure viewer should contain the notification center');
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
assert(serviceWorker.includes('waleedtalal-pwa-v59'));
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

  console.log('secure orders notification and device tests passed');
})();
