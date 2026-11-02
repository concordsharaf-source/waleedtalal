'use strict';

/**
 * registration-duplicate.js
 * ------------------------------------------------------------------
 * منطق منع التكرار في تسجيل الطلبات — نسخة معدّلة.
 *
 * القاعدة القديمة (المرفوضة):
 *   يُرفض الطلب إذا تطابقت **خانة واحدة** من الاسم / الجوال / الهوية / الحساب البنكي.
 *
 * القاعدة الجديدة:
 *   لا يُرفض الطلب إلا إذا تطابقت **خانتان على الأقل** من نفس المستفيد السابق:
 *     1) الاسم الكامل
 *     2) رقم الجوال
 *     3) رقم الحساب البنكي (IBAN)
 *     4) رقم الهوية
 *   والتطابق **تام** بعد التوحيد (لا تطابق جزئي).
 *
 * ملاحظات توافق مع البيانات القديمة:
 *   - الاسم القديم يُخزَّن بثلاث كلمات مع تجاهل (بن / ابن / بنت) — نتبع نفس التوحيد.
 *   - الجوال يُقارَن بآخر 9 أرقام (966552957452 = 0552957452).
 *   - الهوية والحساب: أرقام/حروف فقط بعد NFKC وحروف كبيرة.
 */

const REQUIRED_NAME_PARTS = 3;
const NAME_CONNECTORS = new Set(['بن', 'ابن', 'بنت']);

/** الحد الأدنى لعدد الخانات المتطابقة الذي يوجب الرفض. */
const DUPLICATE_THRESHOLD = 2;

/** أسماء الحقول كما تظهر في واجهة الرفض. */
const FIELD_LABELS = Object.freeze({
    name: 'الاسم الكامل',
    phone: 'رقم الجوال',
    bankAccount: 'رقم الحساب البنكي',
    idNumber: 'رقم الهوية'
});

const FIELD_ORDER = ['name', 'phone', 'bankAccount', 'idNumber'];

function limitText(value, maxLength) {
    return String(value ?? '').normalize('NFKC').trim().slice(0, maxLength);
}

function normalizeDigits(value) {
    return String(value ?? '')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalizeArabicText(value) {
    return limitText(value, 220)
        .toLocaleLowerCase('ar')
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
        .replace(/ـ/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** أول ٣ كلمات اسم بعد تجاهل «بن / ابن / بنت» — نفس سلوك البيانات الحالية. */
function normalizeTripleName(value) {
    const meaningfulParts = normalizeArabicText(value)
        .split(' ')
        .filter(part => part && !NAME_CONNECTORS.has(part));
    return meaningfulParts.slice(0, REQUIRED_NAME_PARTS).join(' ');
}

function countMeaningfulNameParts(value) {
    return normalizeArabicText(value)
        .split(' ')
        .filter(part => part && !NAME_CONNECTORS.has(part)).length;
}

function normalizePhone(value) {
    const digits = normalizeDigits(value).replace(/[^0-9]/g, '');
    return digits.startsWith('00') ? digits.slice(2) : digits;
}

function normalizePhoneKey(value) {
    const phone = normalizePhone(value);
    return phone.length >= 9 ? phone.slice(-9) : phone;
}

function normalizeIdentifier(value) {
    return normalizeDigits(value)
        .normalize('NFKC')
        .toLocaleUpperCase('en')
        .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * القيم الموحّدة لأربع خانات المطابقة.
 * @returns {{name:string, phone:string, bankAccount:string, idNumber:string}}
 */
function normalizedIdentity(data = {}) {
    return {
        name: normalizeTripleName(data.name),
        phone: normalizePhoneKey(data.phone),
        bankAccount: normalizeIdentifier(data.partNumber ?? data.bankAccount),
        idNumber: normalizeIdentifier(data.idNumber)
    };
}

/** هل القيمة صالحة للمقارنة؟ (الفارغ لا يُطابق شيئاً) */
function hasUsableValue(field, value) {
    const text = String(value ?? '');
    if (!text) return false;
    if (field === 'idNumber' || field === 'bankAccount') return text.length >= 4;
    if (field === 'phone') return text.length >= 7;
    if (field === 'name') return text.length >= 3;
    return true;
}

/**
 * الخانات المتطابقة تماماً بين طلب جديد وسجل سابق.
 * @returns {string[]} مثل ['name','phone']
 */
function matchedFields(candidate = {}, existing = {}) {
    const next = normalizedIdentity(candidate);
    const previous = normalizedIdentity(existing);
    return FIELD_ORDER.filter(field =>
        hasUsableValue(field, next[field]) &&
        hasUsableValue(field, previous[field]) &&
        next[field] === previous[field]
    );
}

/** هل يستوفي التطابق حد الرفض (خانتان على الأقل)؟ */
function isRejectedMatch(fields = []) {
    return new Set(fields).size >= DUPLICATE_THRESHOLD;
}

/**
 * فحص سريع على مجموعة الطلبات الحالية (Firestore QuerySnapshot أو مصفوفة كائنات).
 * يُرجع الحقول المتطابقة من **نفس السجل** الذي بلغ حد الرفض.
 */
function collectDuplicateFields(existingOrders, candidate) {
    const fields = new Set();
    const offendingOrders = [];

    for (const order of existingOrders) {
        const data = order && typeof order.data === 'function' ? order.data() : order;
        if (!data) continue;
        const matched = matchedFields(candidate, {
            name: data.name,
            phone: data.phone,
            idNumber: data.idNumber,
            partNumber: data.partNumber
        });
        if (isRejectedMatch(matched)) {
            matched.forEach(field => fields.add(field));
            offendingOrders.push({
                id: order && order.id ? order.id : (data.id || null),
                fields: matched
            });
        }
    }

    return {
        rejected: offendingOrders.length > 0,
        fields: FIELD_ORDER.filter(field => fields.has(field)),
        matches: offendingOrders
    };
}

/** رسالة الرفض العربية. */
function duplicateRejectionMessage(fields = []) {
    const labels = FIELD_ORDER
        .filter(field => fields.includes(field))
        .map(field => FIELD_LABELS[field]);
    if (!labels.length) return 'المستفيد مسجل مسبقًا في النظام، لذلك لا يمكن إنشاء طلب جديد.';
    return `المستفيد مسجل مسبقًا، ووُجد تطابق تام في: ${labels.join('، ')}. لا يمكن إنشاء طلب جديد.`;
}

module.exports = {
    REQUIRED_NAME_PARTS,
    DUPLICATE_THRESHOLD,
    FIELD_LABELS,
    FIELD_ORDER,
    limitText,
    normalizeDigits,
    normalizeArabicText,
    normalizeTripleName,
    countMeaningfulNameParts,
    normalizePhone,
    normalizePhoneKey,
    normalizeIdentifier,
    normalizedIdentity,
    hasUsableValue,
    matchedFields,
    isRejectedMatch,
    collectDuplicateFields,
    duplicateRejectionMessage
};
