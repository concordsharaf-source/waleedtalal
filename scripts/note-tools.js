/**
 * note-tools.js
 * ------------------------------------------------------------------
 * أدوات «التحديث السريع» لحقل «تفاصيل الطلب» في صفحة إدارة الطلبات.
 *
 * تكتشف القيم الموجودة داخل النص (رقم التواصل، مبلغ الرسوم، نوع الرسوم)
 * وتُعيد بناء النص بعد استبدالها بالقيم الجديدة — بمجرد كتابتها.
 *
 * الدوال هنا نقية (بدون DOM) لتسهيل اختبارها.
 */

/* digits لاتينية + عربية + فارسية */
const DIGITS = "0-9\u0660-\u0669\u06F0-\u06F9";

/** رقم التواصل: نفضّل الرقم الذي يلي عبارة «الرقم التالي/رقم التواصل/واتساب». */
export function findNotePhone(text) {
    const value = String(text ?? "");
    const contextual = value.match(
        new RegExp(
            "(?:الرقم\\s+التالي|رقم\\s+التواصل|رقم\\s+الجوال|واتساب|جوال|هاتف)" +
            "[^+0-9\u0660-\u0669]{0,40}" +
            "(\\+?[" + DIGITS + "][" + DIGITS + "\\s\\-()]{7,}[" + DIGITS + "])",
            "u"
        )
    );
    if (contextual) return contextual[1].trim();

    const generic = value.match(
        new RegExp("(\\+?[" + DIGITS + "][" + DIGITS + "\\s\\-()]{8,}[" + DIGITS + "])", "u")
    );
    return generic ? generic[1].trim() : "";
}

/** مبلغ الرسوم: الرقم الذي يسبق كلمة «ريال» مباشرة (مثل: (3,750 ريال سعودي)). */
export function findNoteAmount(text) {
    const value = String(text ?? "");
    const matched = value.match(
        new RegExp("([" + DIGITS + "][" + DIGITS + ",.٬٫]*)\\s*(?:ريال|ر\\.س|SAR)", "iu")
    );
    return matched ? matched[1].trim() : "";
}

/** نوع الرسوم: النص الذي يلي «مقابل رسوم …» وي precede «وذلك/وفقًا/،/.». */
export function findNoteFeeType(text) {
    const value = String(text ?? "");
    const matched = value.match(
        /(?:^|[\s،؛.:()])((?:مقابل\s+)?رسوم\s+)([\u0600-\u06FF][\u0600-\u06FF\s]*?)(?=\s*(?:وذلك|ووفق|وفق|،|\.|؛|$))/u
    );
    if (!matched) return "";
    const found = matched[2].trim();
    /* نتجاهل عبارة «الرسوم المقررة …» فهي ليست نوع الرسوم. */
    if (!found || /^المقررة/.test(found)) return "";
    return found;
}

/** يكتشف القيم الثلاث دفعة واحدة. */
export function detectNoteValues(text) {
    return {
        phone: findNotePhone(text),
        amount: findNoteAmount(text),
        feeType: findNoteFeeType(text)
    };
}

/* رموز مؤقتة لا يمكن أن تظهر في نص بشري عادي، لتفادي تضارب القيم أثناء الاستبدال. */
const TOKEN = {
    phone: "\u0001NOTE_PHONE\u0001",
    amount: "\u0001NOTE_AMOUNT\u0001",
    feeType: "\u0001NOTE_TYPE\u0001"
};

function putToken(text, oldValue, token, newValue, insert) {
    if (oldValue && text.indexOf(oldValue) !== -1) {
        return text.replace(oldValue, () => token);
    }
    return newValue ? insert(text, token) : text;
}

function appendLine(text, line) {
    return String(text).replace(/\s*$/u, "") + (String(text).trim() ? "\n" : "") + line;
}

function insertAmount(text, token) {
    const parenthesized = new RegExp("(\\()([" + DIGITS + "][" + DIGITS + ",.٬٫]*)(\\))", "u");
    if (parenthesized.test(text)) {
        return text.replace(parenthesized, (match, open, value, close) => open + token + close);
    }
    return appendLine(text, "مبلغ الرسوم: " + token + " ريال سعودي");
}

/**
 * يعيد بناء نص «تفاصيل الطلب» من النص الأساسي مع استبدال القيم الثلاث.
 * @param {string} base النص الأصلي (كما التُقط عند فتح النافذة أو آخر تعديل يدوي)
 * @param {{phone:string, amount:string, feeType:string}} detected القيم المكتشفة في base
 * @param {{phone:string, amount:string, feeType:string}} values القيم الحالية في الحقول المساعدة
 */
export function buildNoteText(base, detected, values) {
    let text = String(base ?? "");
    const phone = String(values.phone ?? "");
    const amount = String(values.amount ?? "");
    const feeType = String(values.feeType ?? "");

    text = putToken(text, detected.phone, TOKEN.phone, phone,
        t => appendLine(t, "رقم التواصل: " + TOKEN.phone));
    text = putToken(text, detected.amount, TOKEN.amount, amount, insertAmount);
    text = putToken(text, detected.feeType, TOKEN.feeType, feeType,
        t => appendLine(t, "نوع الرسوم: " + TOKEN.feeType));

    return text
        .split(TOKEN.phone).join(phone)
        .split(TOKEN.amount).join(amount)
        .split(TOKEN.feeType).join(feeType);
}
