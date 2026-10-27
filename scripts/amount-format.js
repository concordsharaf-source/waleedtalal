/**
 * amount-format.js
 * ------------------------------------------------------------------
 * تنسيق «مبلغ المنحة» بإضافة فاصلة بعد كل 3 أرقام: 1000000 → 1,000,000
 *
 * - يحافظ على الكسور العشرية (650000.50 → 650,000.50) والعملة/النص المرافق.
 * - لا يكرّر الفواصل إن كانت القيمة منسّقة مسبقاً (1,234,567 تبقى كما هي).
 * - يوحّد الأرقام العربية والفارسية إلى أرقام لاتينية قبل التنسيق.
 * - يُستخدم في صفحات الإدارة (`admon.html`, `orders-view-secure.html`)
 *   وصفحة الحالة العامة (`status.html`).
 */

export function normalizeDigits(value) {
    return String(value ?? "")
        .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/٬/g, ","); // فاصل الآلاف العربي
}

/** يُعيد النص مع فاصلة بعد كل 3 أرقام في الجزء الصحيح من كل رقم يظهر في النص. */
export function formatAmount(value) {
    const text = normalizeDigits(value);
    if (!text.trim()) return "";
    return text.replace(/(\d+)(?:([.,٫])(\d+))?/g, (match, integer, separator, fraction) => {
        const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        if (!separator) return grouped;
        // الفاصلة العشرية العربية (٫) تُوحّد إلى النقطة، والفاصلة اللاتينية تُبقى كما هي.
        const decimalSeparator = separator === "٫" ? "." : separator;
        return grouped + decimalSeparator + fraction;
    });
}

/**
 * يربط التنسيق المباشر بحقل الإدخال أثناء الكتابة، مع الحفاظ على موضع المؤشر
 * بحساب عدد الأرقام قبله (حتى لا يقفز المؤشر إلى نهاية الحقل بعد كل فاصلة).
 */
export function attachAmountFormatting(input) {
    if (!input) return;

    function apply() {
        const before = input.value;
        const formatted = formatAmount(before);
        if (formatted === before) return;

        const caret = typeof input.selectionStart === "number" ? input.selectionStart : before.length;
        const digitsBeforeCaret = (before.slice(0, caret).match(/\d/g) || []).length;

        input.value = formatted;

        let position = formatted.length;
        if (digitsBeforeCaret > 0) {
            let seen = 0;
            position = 0;
            while (position < formatted.length && seen < digitsBeforeCaret) {
                if (/\d/.test(formatted[position])) seen++;
                position++;
            }
        }
        try {
            input.setSelectionRange(position, position);
        } catch { /* بعض أنواع الحقول لا تدعم تحديد المؤشر */ }
    }

    input.addEventListener("input", apply);
    input.addEventListener("blur", () => {
        input.value = formatAmount(input.value);
    });
}
