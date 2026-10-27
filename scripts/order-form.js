/**
 * order-form.js
 * ------------------------------------------------------------------
 * ملف مشترك لبناء "نموذج طلب المساعدة" من البيانات التي سجلها المستفيد،
 * ثم توليد رابط واتساب (wa.me) يحتوي على النموذج كاملاً بدلاً من
 * رسالة الاستفسار القديمة: "أحتاج المساعدة بخصوص المعاملة رقم ...".
 *
 * يُستخدم من:
 *   - pages/us.html            (بعد نجاح تسجيل الطلب)
 *   - scripts/chat-beneficiary.js (زر واتساب داخل المحادثة الداخلية)
 *
 * ملاحظة: واتساب لا يسمح بالإرسال التلقائي؛ الرابط يفتح المحادثة بالنص
 * جاهزاً، والمستخدم يضغط "إرسال". لا حاجة لأي مفتاح أو API خارجي.
 */

/** رقم واتساب الإدارة المستقبل للطلبات (بدون + أو مسافات). */
export const ADMIN_WHATSAPP_NUMBER = "966580272758";

/** مفتاح حفظ آخر نموذج تم تسجيله في المتصفح (localStorage). */
export const ORDER_FORM_STORAGE_KEY = "waleed_last_order_form";

/**
 * اختياري: غيّر القيمة إلى true إذا أردت إخفاء جزء من رقم الهوية والآيبان
 * في رسالة واتساب (يبقى النموذج في قاعدة البيانات والمحادثة الداخلية كاملاً).
 */
export const MASK_SENSITIVE_FIELDS = false;

const MISSING = "غير محدد";

function field(value, fallback = MISSING, maxLength = 300) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sensitive(value) {
    const text = field(value, "", 120);
    if (!text) return MISSING;
    if (!MASK_SENSITIVE_FIELDS || text.length <= 4) return text;
    return `${text.slice(0, 2)}${"•".repeat(Math.min(text.length - 4, 14))}${text.slice(-2)}`;
}

/** يدمج بيانات الطلب مع آخر نموذج محفوظ، مع تجاهل القيم الفارغة. */
export function mergeOrderForm(order = {}) {
    const merged = { ...(readOrderForm() || {}), ...(order || {}) };
    return Object.fromEntries(
        Object.entries(merged).filter(([, value]) => value !== undefined && value !== null)
    );
}

/**
 * يبني نص النموذج بنفس حقول رسالة المحادثة الداخلية (chat-core.js)
 * حتى تصل للإدارة عبر واتساب نفس البيانات المسجلة تماماً.
 */
export function buildOrderFormText(order = {}) {
    const transactionId = field(order.transactionId, "—");
    return [
        "📋 *نموذج طلب مساعدة — مؤسسة الوليد للإنسانية*",
        `🔢 رقم المعاملة: #${transactionId}`,
        "────────────────────",
        `👤 المستفيد: ${field(order.name)}`,
        `🆔 رقم الهوية: ${sensitive(order.idNumber)}`,
        `🌍 الدولة: ${field(order.country)}`,
        `📞 رقم الهاتف: ${field(order.phone)}`,
        `✉️ البريد الإلكتروني: ${field(order.email)}`,
        `🏦 اسم البنك: ${field(order.bankName)}`,
        `💳 رقم الحساب/الآيبان: ${sensitive(order.partNumber)}`,
        `📂 نوع الطلب: ${field(order.type)}`,
        `📝 شرح الاحتياج: ${field(order.notes, MISSING, 600)}`,
        `📍 حالة الطلب: ${field(order.status, "قيد المراجعة")}`,
        "",
        "هذه بيانات نموذج طلب المساعدة الذي تم تسجيله، نرجو مراجعته واستكمال الإجراءات."
    ].join("\n");
}

/** يولّد رابط واتساب بالنموذج كاملاً مشفراً بشكل صحيح (يدعم العربية والرموز). */
export function buildWhatsappUrl(order = {}, phoneNumber = ADMIN_WHATSAPP_NUMBER) {
    const message = buildOrderFormText(order);
    return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

/** حفظ النموذج لاستخدامه في صفحة المحادثة قبل تحميل البيانات من Firestore. */
export function saveOrderForm(order) {
    try {
        localStorage.setItem(ORDER_FORM_STORAGE_KEY, JSON.stringify({ ...(order || {}) }));
    } catch { /* التخزين المحلي غير متاح - لا نعطل التسجيل */ }
}

export function readOrderForm() {
    try {
        const value = JSON.parse(localStorage.getItem(ORDER_FORM_STORAGE_KEY) || "null");
        return value && typeof value === "object" ? value : null;
    } catch {
        return null;
    }
}
