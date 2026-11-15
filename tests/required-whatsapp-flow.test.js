const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('pages/us.html', 'utf8');
const moduleMatch = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].at(-1);
assert(moduleMatch, 'module script not found');
let source = moduleMatch[1];
source = source.slice(source.indexOf('/* حفظ أرقام الجوال'));
source = `
const buildWhatsappUrl = (form, phone) => 'https://wa.me/' + phone + '?text=' + encodeURIComponent(form.transactionId);
const saveOrderForm = () => {};
const getDeviceDetails = async () => ({});
${source}
globalThis.__hooks = {
  prepareRequiredWhatsappHandoff,
  completeRequiredWhatsappHandoff,
  copyTransactionId,
  isSuccessModalOpen,
  getGuardActive(){ return requiredWhatsappGuardActive; }
};`;

class FakeClassList {
  constructor(){ this.values = new Set(); }
  add(value){ this.values.add(value); }
  remove(value){ this.values.delete(value); }
  contains(value){ return this.values.has(value); }
}

class FakeElement {
  constructor(id, tagName = 'div'){
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.style = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.textContent = '';
    this.innerText = '';
    this.href = '';
    this.focusCount = 0;
    this.disabled = false;
  }
  addEventListener(type, handler){ (this.listeners[type] ||= []).push(handler); }
  setAttribute(name, value){ this.attributes[name] = String(value); }
  getAttribute(name){ return this.attributes[name]; }
  focus(){ this.focusCount += 1; }
  select(){ this.selected = true; }
  setSelectionRange(){ this.selected = true; }
  remove(){ this.removed = true; }
  closest(selector){ return selector === 'a,button' && ['A','BUTTON'].includes(this.tagName) ? this : null; }
  async emit(type, event = {}){
    for(const handler of this.listeners[type] || []) await handler(event);
  }
}

function makeRuntime(pending = null, fetchHandler = null){
  const ids = [
    'sendBtn','btnText','requestSuccessModal','requiredWhatsappButton',
    'requiredWhatsappButtonText','requiredHandoffWarning','postWhatsappActions','requestRejectedModal',
    'requestRejectedMessage','closeRejectedModal','successApplicantName',
    'successTransactionId','name','phone','email','idNumber','partNumber',
    'bankName','country','type','notes'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements.requiredWhatsappButton.tagName = 'A';
  elements.closeRejectedModal.tagName = 'BUTTON';
  elements.sendBtn.tagName = 'BUTTON';
  elements.requestSuccessModal.hidden = true;
  elements.requestRejectedModal.hidden = true;
  elements.requiredHandoffWarning.hidden = true;
  elements.postWhatsappActions.hidden = true;

  const documentListeners = {};
  const windowListeners = {};
  const storage = new Map();
  if(pending) storage.set('waleed_required_whatsapp_handoff_v1', JSON.stringify(pending));
  const clipboardWrites = [];
  let execCopyCount = 0;
  const alerts = [];

  const document = {
    body: {
      style: {},
      appendChild(element){ element.parentNode = this; }
    },
    getElementById(id){ return elements[id] || null; },
    createElement(tag){ return new FakeElement('', tag); },
    execCommand(command){ if(command === 'copy'){ execCopyCount += 1; return true; } return false; },
    addEventListener(type, handler, options){ (documentListeners[type] ||= []).push({handler, options}); }
  };
  const history = { pushes: 0, pushState(){ this.pushes += 1; } };
  const sessionStorage = {
    getItem(key){ return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value){ storage.set(key, String(value)); },
    removeItem(key){ storage.delete(key); }
  };
  const localStorage = { setItem(){}, getItem(){ return null; }, removeItem(){} };
  const window = {
    addEventListener(type, handler){ (windowListeners[type] ||= []).push(handler); },
    setTimeout(handler){ handler(); return 1; }
  };
  const navigator = {
    clipboard: { async writeText(value){ clipboardWrites.push(String(value)); } }
  };
  const context = vm.createContext({
    console, document, window, history, location: {href:'https://example.test/pages/us.html'},
    sessionStorage, localStorage, navigator,
    alert(message){ alerts.push(message); },
    fetch: fetchHandler || (async () => { throw new Error('unexpected fetch'); }),
    setTimeout(handler){ handler(); }, clearTimeout(){},
    URL, JSON, String, Boolean, Array, Set, Promise, Error
  });
  vm.runInContext(source, context, {filename:'us-inline-module.mjs'});
  return {
    ...context.__hooks, context, elements, documentListeners, windowListeners,
    history, storage, clipboardWrites, alerts,
    get execCopyCount(){ return execCopyCount; }
  };
}

function fakeEvent(target){
  return {
    target,
    prevented: false,
    stopped: false,
    key: '',
    preventDefault(){ this.prevented = true; },
    stopImmediatePropagation(){ this.stopped = true; }
  };
}

(async () => {
  const runtime = makeRuntime();
  const {elements} = runtime;
  const whatsappUrl = 'https://wa.me/966580272758?text=TX-987';
  assert.equal(runtime.prepareRequiredWhatsappHandoff('TX-987', 'مستفيد تجريبي', whatsappUrl), true);
  assert.equal(elements.requestSuccessModal.hidden, false, 'success modal should open');
  assert.equal(elements.postWhatsappActions.hidden, true, 'alternatives must remain hidden');
  assert.equal(elements.requiredWhatsappButton.href, whatsappUrl, 'generated WhatsApp URL must be preserved');
  assert.equal(elements.successTransactionId.textContent, 'TX-987');
  assert.equal(runtime.getGuardActive(), true, 'guard should activate');
  assert.equal(runtime.history.pushes, 1, 'guard history entry should be pushed');
  assert(runtime.storage.has('waleed_required_whatsapp_handoff_v1'), 'pending handoff should persist');

  const unloadBefore = fakeEvent(null);
  runtime.windowListeners.beforeunload[0](unloadBefore);
  assert.equal(unloadBefore.prevented, true, 'unload must be warned before required action');
  assert.equal(unloadBefore.returnValue, 'يجب عليك إرسال النموذج بالواتساب لإكمال عملية التسجيل');

  assert.equal(elements.requiredHandoffWarning.hidden, true, 'Arabic warning starts hidden');
  runtime.windowListeners.popstate[0]();
  assert.equal(runtime.history.pushes, 2, 'Back should be trapped with a new history entry');
  assert.equal(elements.requiredHandoffWarning.hidden, false, 'Back should reveal the Arabic warning');
  assert.equal(elements.requiredHandoffWarning.textContent, '⚠️ يجب عليك إرسال النموذج بالواتساب لإكمال عملية التسجيل');

  const otherLink = new FakeElement('other', 'a');
  const blockedClick = fakeEvent(otherLink);
  runtime.documentListeners.click[0].handler(blockedClick);
  assert.equal(blockedClick.prevented, true, 'other navigation must be blocked');
  assert.equal(blockedClick.stopped, true, 'other navigation propagation must stop');

  const requiredClick = fakeEvent(elements.requiredWhatsappButton);
  runtime.documentListeners.click[0].handler(requiredClick);
  assert.equal(requiredClick.prevented, false, 'required anchor default must remain available to open WhatsApp');
  await elements.requiredWhatsappButton.emit('click', requiredClick);
  assert.equal(requiredClick.prevented, false, 'WhatsApp opening must not be cancelled');
  assert.equal(runtime.getGuardActive(), false, 'guard should release only after required click');
  assert.equal(elements.requiredHandoffWarning.hidden, true, 'warning should clear after required click');
  assert.equal(elements.postWhatsappActions.hidden, false, 'alternatives should reveal after required click');
  assert.equal(runtime.storage.has('waleed_required_whatsapp_handoff_v1'), false, 'pending state should clear');
  assert(runtime.clipboardWrites.includes('TX-987'), 'Clipboard API should receive transaction ID');
  assert(runtime.execCopyCount >= 1, 'legacy clipboard fallback should be attempted directly in the click');
  assert.equal(elements.requiredWhatsappButtonText.textContent, 'تم النسخ — فتح واتساب مجدداً');

  const unloadAfter = fakeEvent(null);
  runtime.windowListeners.beforeunload[0](unloadAfter);
  assert.equal(unloadAfter.prevented, false, 'unload should be released after required action');

  await elements.requiredWhatsappButton.emit('click', fakeEvent(elements.requiredWhatsappButton));
  assert.equal(runtime.clipboardWrites.filter(value => value === 'TX-987').length, 2, 'repeated click should copy again');

  const restored = makeRuntime({
    transactionId:'RESTORE-123',
    applicantName:'مستفيد مستعاد',
    whatsappUrl:'https://wa.me/966580272758?text=RESTORE-123'
  });
  assert.equal(restored.elements.requestSuccessModal.hidden, false, 'pending handoff must restore after reload');
  assert.equal(restored.elements.postWhatsappActions.hidden, true, 'restored alternatives stay hidden');
  assert.equal(restored.elements.successTransactionId.textContent, 'RESTORE-123');
  assert.equal(restored.getGuardActive(), true, 'restored handoff must re-enable guard');

  const successRegistration = makeRuntime(null, async () => ({
    ok:true,
    status:200,
    async json(){ return {transactionId:'NEW-456', orderId:'order-456'}; }
  }));
  Object.assign(successRegistration.elements.name, {value:'مستفيد تجريبي ثلاثي'});
  Object.assign(successRegistration.elements.phone, {value:'٠٥٠١٢٣٤٥٦٧'});
  Object.assign(successRegistration.elements.country, {value:'السعودية'});
  Object.assign(successRegistration.elements.type, {value:'مساعدة مالية'});
  await successRegistration.elements.sendBtn.onclick();
  assert.equal(successRegistration.elements.requestSuccessModal.hidden, false, 'successful registration should enter required flow');
  assert.equal(successRegistration.elements.successTransactionId.textContent, 'NEW-456');
  assert.equal(successRegistration.elements.postWhatsappActions.hidden, true);
  assert.equal(successRegistration.getGuardActive(), true);

  const duplicateRegistration = makeRuntime(null, async () => ({
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
  Object.assign(duplicateRegistration.elements.name, {value:'مستفيد مكرر ثلاثي'});
  Object.assign(duplicateRegistration.elements.phone, {value:'0501234567'});
  Object.assign(duplicateRegistration.elements.country, {value:'السعودية'});
  Object.assign(duplicateRegistration.elements.type, {value:'مساعدة مالية'});
  await duplicateRegistration.elements.sendBtn.onclick();
  assert.equal(duplicateRegistration.elements.requestSuccessModal.hidden, true, 'duplicate rejection must stay outside success flow');
  assert.equal(duplicateRegistration.elements.requestRejectedModal.hidden, false, 'duplicate rejection modal should open');
  assert.equal(duplicateRegistration.getGuardActive(), false);

  let invalidFetchCalled = false;
  const invalidRegistration = makeRuntime(null, async () => {
    invalidFetchCalled = true;
    throw new Error('invalid form must not submit');
  });
  await invalidRegistration.elements.sendBtn.onclick();
  assert.equal(invalidFetchCalled, false, 'invalid registration must not call the API');
  assert.equal(invalidRegistration.elements.requestSuccessModal.hidden, true, 'invalid registration must stay outside success flow');
  assert(invalidRegistration.alerts.length > 0, 'invalid registration should explain required fields');

  console.log('required WhatsApp flow tests passed');
})();
