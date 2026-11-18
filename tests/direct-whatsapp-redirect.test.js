const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('pages/us.html', 'utf8');
assert(!html.includes('requestSuccessModal'), 'the retired success handoff modal must be removed');
assert(!html.includes('prepareRequiredWhatsappHandoff'), 'the retired second-click handoff must be removed');
assert(html.includes('window.location.assign(whatsappUrl)'), 'successful registration must navigate directly to WhatsApp');

const moduleMatch = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].at(-1);
assert(moduleMatch, 'module script not found');
let source = moduleMatch[1];
source = source.slice(source.indexOf('/* حفظ أرقام الجوال'));
source = `
const buildWhatsappUrl = (form, phone) => {
  globalThis.__events.push('build-whatsapp');
  globalThis.__builtForm = form;
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(form.transactionId);
};
const saveOrderForm = (form) => {
  globalThis.__events.push('save-local-form');
  globalThis.__savedForm = form;
};
const getDeviceDetails = async () => ({deviceType:'هاتف'});
${source}`;

class FakeElement {
  constructor(id, tagName = 'div'){
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.innerText = '';
    this.disabled = false;
    this.listeners = {};
    this.focusCount = 0;
  }
  addEventListener(type, handler){ (this.listeners[type] ||= []).push(handler); }
  focus(){ this.focusCount += 1; }
}

function makeRuntime(fetchHandler){
  const ids = [
    'sendBtn','btnText','requestRejectedModal','requestRejectedMessage',
    'closeRejectedModal','name','phone','email','idNumber','partNumber',
    'bankName','country','type','notes'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements.sendBtn.tagName = 'BUTTON';
  elements.closeRejectedModal.tagName = 'BUTTON';
  elements.requestRejectedModal.hidden = true;
  elements.btnText.innerText = 'إرسال الطلب';

  const events = [];
  const alerts = [];
  const assignedUrls = [];
  const localValues = new Map();
  const sessionValues = new Map([
    ['waleed_required_whatsapp_handoff_v1', '{"obsolete":true}']
  ]);
  let fetchCount = 0;
  let requestBody = null;

  const document = {
    body:{style:{}},
    getElementById(id){ return elements[id] || null; }
  };
  const localStorage = {
    setItem(key, value){
      events.push(key === 'waleed_internal_chat_session' ? 'save-chat-session' : `local:${key}`);
      localValues.set(key, String(value));
    },
    getItem(key){ return localValues.get(key) || null; },
    removeItem(key){ localValues.delete(key); }
  };
  const sessionStorage = {
    setItem(key, value){ sessionValues.set(key, String(value)); },
    getItem(key){ return sessionValues.get(key) || null; },
    removeItem(key){ sessionValues.delete(key); }
  };
  const window = {
    location:{
      assign(url){
        events.push('redirect-whatsapp');
        assignedUrls.push(String(url));
      }
    }
  };
  const context = vm.createContext({
    console:{log(){}, warn(){}, error(){}}, document, window, localStorage, sessionStorage,
    __events:events,
    alert(message){ alerts.push(String(message)); },
    fetch:async (url, options) => {
      fetchCount += 1;
      requestBody = JSON.parse(options.body);
      events.push('register-api');
      return fetchHandler(url, options);
    },
    JSON, String, Array, Set, Promise, Error
  });
  vm.runInContext(source, context, {filename:'us-inline-module.mjs'});

  return {
    elements, events, alerts, assignedUrls, localValues, sessionValues, context,
    get fetchCount(){ return fetchCount; },
    get requestBody(){ return requestBody; }
  };
}

function fillValidForm(runtime){
  runtime.elements.name.value = 'مستفيد تجريبي ثلاثي';
  runtime.elements.phone.value = '٠٥٠١٢٣٤٥٦٧';
  runtime.elements.email.value = 'test@example.com';
  runtime.elements.idNumber.value = '1234567890';
  runtime.elements.partNumber.value = 'SA001234567890';
  runtime.elements.bankName.value = 'بنك الاختبار';
  runtime.elements.country.value = 'السعودية';
  runtime.elements.type.value = 'مساعدة مالية';
  runtime.elements.notes.value = 'حالة اختبار';
}

(async () => {
  const successful = makeRuntime(async () => ({
    ok:true,
    status:200,
    async json(){ return {transactionId:'NEW-456', orderId:'order-456'}; }
  }));
  assert.equal(successful.sessionValues.has('waleed_required_whatsapp_handoff_v1'), false, 'obsolete handoff state should be cleared');
  fillValidForm(successful);
  await successful.elements.sendBtn.onclick();

  assert.equal(successful.fetchCount, 1, 'registration API should be called once');
  assert.equal(successful.requestBody.phone, '0501234567', 'Arabic phone digits should be normalized');
  assert.equal(successful.requestBody.deviceType, 'هاتف', 'device details should still be submitted');
  assert.equal(successful.context.__savedForm.transactionId, 'NEW-456', 'saved local form should contain the server transaction');
  assert(successful.localValues.has('waleed_internal_chat_session'), 'internal chat session should still be saved');
  assert.deepEqual(successful.events.slice(0, 5), [
    'register-api',
    'save-local-form',
    'save-chat-session',
    'build-whatsapp',
    'redirect-whatsapp'
  ], 'site and local saves must complete before WhatsApp navigation');
  assert.equal(successful.assignedUrls.length, 1, 'WhatsApp should open directly after a successful save');
  assert(successful.assignedUrls[0].startsWith('https://wa.me/966580272758?text='));
  assert.equal(successful.elements.sendBtn.disabled, true, 'button should stay locked while leaving for WhatsApp');
  assert.equal(successful.elements.btnText.innerText, 'تم حفظ الطلب، جاري فتح واتساب...');

  const duplicate = makeRuntime(async () => ({
    ok:false,
    status:409,
    async json(){
      return {
        error:'beneficiary-already-registered',
        duplicateFields:['name','phone'],
        message:'المستفيد مسجل مسبقًا.'
      };
    }
  }));
  fillValidForm(duplicate);
  await duplicate.elements.sendBtn.onclick();
  assert.equal(duplicate.assignedUrls.length, 0, 'duplicate rejection must not open WhatsApp');
  assert.equal(duplicate.elements.requestRejectedModal.hidden, false, 'duplicate rejection modal should open');
  assert.equal(duplicate.elements.sendBtn.disabled, false, 'button should reset after rejection');

  let invalidFetchCalled = false;
  const invalid = makeRuntime(async () => {
    invalidFetchCalled = true;
    throw new Error('invalid form must not submit');
  });
  await invalid.elements.sendBtn.onclick();
  assert.equal(invalidFetchCalled, false, 'invalid form must not call the API');
  assert.equal(invalid.assignedUrls.length, 0, 'invalid form must not open WhatsApp');
  assert(invalid.alerts.length > 0, 'invalid form should explain required fields');

  const failed = makeRuntime(async () => ({
    ok:false,
    status:500,
    async json(){ return {error:'server-error'}; }
  }));
  fillValidForm(failed);
  await failed.elements.sendBtn.onclick();
  assert.equal(failed.assignedUrls.length, 0, 'failed save must not open WhatsApp');
  assert.equal(failed.elements.sendBtn.disabled, false, 'button should reset after a failed save');
  assert.equal(failed.elements.btnText.innerText, 'إرسال الطلب');

  console.log('direct WhatsApp redirect tests passed');
})();
