'use strict';

/**
 * اختبارات قاعدة منع التكرار: رفض فقط عند تطابق خانتين على الأقل، وتطابق تام.
 * التشغيل:  node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    matchedFields,
    collectDuplicateFields,
    duplicateRejectionMessage,
    normalizeTripleName,
    normalizePhoneKey,
    normalizeIdentifier,
    DUPLICATE_THRESHOLD
} = require('../lib/registration-duplicate');

/** سجل حقيقي من قاعدة البيانات (طلب #6057). */
const EXISTING = {
    id: '0GHnw1LdMlhki1Y4zMeW',
    name: 'رايد رجاء سبيع الكلوي الخلوي',
    phone: '966552957452',
    idNumber: '1035397023',
    partNumber: 'SA0980000253608010146516'
};

const candidate = (overrides = {}) => ({
    name: 'سالم صالح قاسم الحميري',
    phone: '967777001122',
    idNumber: '2088776655',
    partNumber: 'SA4420000001234567891234',
    ...overrides
});

/* ---------- التوحيد ---------- */

test('الاسم: أول ثلاث كلمات بعد تجاهل «بن» وتوحيد الهمزات', () => {
    assert.equal(normalizeTripleName('محمد بن أحمد عبدالله الزبيدي'), 'محمد احمد عبدالله');
    assert.equal(normalizeTripleName('فاطمة علي محمد'), normalizeTripleName('فاطمه علي محمد'));
});

test('الجوال: آخر 9 أرقام بكل الصيغ', () => {
    assert.equal(normalizePhoneKey('+966 55 295 7452'), '552957452');
    assert.equal(normalizePhoneKey('00966552957452'), '552957452');
    assert.equal(normalizePhoneKey('٠٥٥٢٩٥٧٤٥٢'), '552957452');
});

test('الهوية والآيبان: أرقام/حروف فقط', () => {
    assert.equal(normalizeIdentifier('1035397023'), '1035397023');
    assert.equal(normalizeIdentifier('sa098 0000 2536 0801 0146 516'), 'SA0980000253608010146516');
});

/* ---------- القاعدة الجديدة: خانة واحدة لا ترفض ---------- */

for (const [field, value] of [
    ['name', EXISTING.name],
    ['phone', EXISTING.phone],
    ['idNumber', EXISTING.idNumber],
    ['partNumber', EXISTING.partNumber]
]) {
    test(`خانة واحدة فقط متطابقة (${field}) => مقبول`, () => {
        const verdict = collectDuplicateFields([EXISTING], candidate({ [field]: value }));
        assert.equal(verdict.rejected, false);
        assert.deepEqual(verdict.fields, []);
    });
}

/* ---------- خانتان أو أكثر => رفض ---------- */

test('اسم + جوال => مرفوض', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ name: EXISTING.name, phone: EXISTING.phone }));
    assert.equal(verdict.rejected, true);
    assert.deepEqual(verdict.fields, ['name', 'phone']);
});

test('جوال + هوية => مرفوض', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ phone: EXISTING.phone, idNumber: EXISTING.idNumber }));
    assert.equal(verdict.rejected, true);
    assert.deepEqual(verdict.fields, ['phone', 'idNumber']);
});

test('حساب + هوية => مرفوض', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ partNumber: EXISTING.partNumber, idNumber: EXISTING.idNumber }));
    assert.equal(verdict.rejected, true);
    assert.deepEqual(verdict.fields, ['bankAccount', 'idNumber']);
});

test('أربع خانات => مرفوض وكل الحقول', () => {
    const verdict = collectDuplicateFields([EXISTING], {
        name: 'رايد رجاء سبيع الكلوي الخلوي',
        phone: '0552957452',
        idNumber: '1035397023',
        partNumber: 'sa0980000253608010146516'
    });
    assert.equal(verdict.rejected, true);
    assert.deepEqual(verdict.fields, ['name', 'phone', 'bankAccount', 'idNumber']);
});

test('الحد الأدنى للرفض = خانتان', () => {
    assert.equal(DUPLICATE_THRESHOLD, 2);
});

/* ---------- تطابق تام فقط ---------- */

test('اسم أول فقط لا يُعد تطابقاً', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ name: 'رايد', phone: EXISTING.phone }));
    assert.equal(verdict.rejected, false);
});

test('جوال ناقص رقم لا يُطابق', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ name: EXISTING.name, phone: '055295745' }));
    assert.equal(verdict.rejected, false);
});

test('هوية بفارق رقم لا تُطابق', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ phone: EXISTING.phone, idNumber: '1035397024' }));
    assert.equal(verdict.rejected, false);
});

test('آيبان بفارق حرف لا يُطابق', () => {
    const verdict = collectDuplicateFields([EXISTING], candidate({ phone: EXISTING.phone, partNumber: 'SA0980000253608010146517' }));
    assert.equal(verdict.rejected, false);
});

/* ---------- خانتان من سجلين مختلفين لا ترفض ---------- */

test('خانة من سجل وخانة من سجل آخر => مقبول', () => {
    const a = { id: 'a', name: 'رايد رجاء سبيع الكلوي الخلوي' };
    const b = { id: 'b', idNumber: '1035397023' };
    const verdict = collectDuplicateFields([a, b], candidate({ name: 'رايد رجاء سبيع الكلوي الخلوي', idNumber: '1035397023' }));
    assert.equal(verdict.rejected, false);
});

/* ---------- القيم الفارغة ---------- */

test('الحقول الفارغة لا تُطابق أبداً', () => {
    const empty = { id: 'e', name: '', phone: '', idNumber: '', partNumber: '' };
    assert.deepEqual(matchedFields({ name: '', phone: '', idNumber: '', partNumber: '' }, empty), []);
    const verdict = collectDuplicateFields([empty], candidate({ phone: '967777001999' }));
    assert.equal(verdict.rejected, false);
});

/* ---------- رسالة الرفض ---------- */

test('الرسالة تذكر الخانات المتطابقة', () => {
    const message = duplicateRejectionMessage(['name', 'phone']);
    assert.match(message, /الاسم الكامل/);
    assert.match(message, /رقم الجوال/);
    assert.match(message, /تطابق تام/);
});
