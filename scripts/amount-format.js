/**
 * amount-format.js
 * ------------------------------------------------------------------
 * تنسيق «مبلغ المنحة» بإضافة فاصلة بعد كل 3 أرقام: 1000000 → 1,000,000
 *
 * - يحافظ على الكسور العشرية (650000.50 → 650,000.50) والعملة/النص المرافق.
 * - الفاصلة «,» هي فاصل آلاف دائماً، والنقطة «.» وحدها هي الفاصل العشري؛
 *   لذلك تُصحّح أي قيمة خاطئة مثل 1,500000 إلى 1,500,000.
 * - يوحّد الأرقام العربية والفارسية إلى أرقام لاتينية قبل التنسيق.
 * - يُستخدم في صفحات الإدارة (`admon.html`, `orders-view-secure.html`)
 *   وصفحة الحالة العامة (`status.html`).
 */

export function normalizeDigits(value) {
    return String(value ?? "")
        .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/٬/g, ",")  // فاصل الآلاف العربي
        .replace(/٫/g, "."); // الفاصل العشري العربي
}

/**
 * يُعيد النص مع فاصلة بعد كل 3 أرقام في الجزء الصحيح من كل رقم.
 * القاعدة الأساسية: الفاصلة «,» فاصل آلاف فقط، والنقطة «.» وحدها فاصل عشري.
 * لذلك تُزال كل الفواصل القديمة ثم يُعاد تجميع الأرقام من الصفر — مهما كبر الرقم.
 */
export function formatAmount(value) {
    const text = normalizeDigits(value);
    if (!text.trim()) return "";

    return text.replace(/[\d][\d,.]*/g, (run) => {
        // آخر نقطة هي الفاصل العشري الحقيقي (أو نقطة يكتبها المستخدم الآن).
        const dotIndex = run.lastIndexOf(".");
        let integerPart = run;
        let decimalPart = "";
        let hasDecimal = false;

        if (dotIndex !== -1) {
            const afterDot = run.slice(dotIndex + 1).replace(/,/g, "");
            if (afterDot === "" || /^\d+$/.test(afterDot)) {
                hasDecimal = true;
                integerPart = run.slice(0, dotIndex);
                decimalPart = afterDot;
            }
        }

        // إزالة كل الفواصل/النقاط من الجزء الصحيح ثم إعادة التجميع بعد كل 3 أرقام.
        const digits = integerPart.replace(/[^\d]/g, "");
        if (!digits) return run;
        const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return grouped + (hasDecimal ? "." + decimalPart : "");
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
