<?php
// ============================================================
// webhook.php - استقبال الرسائل الواردة
// ============================================================

// 🔴 ضع التوكن هنا للتحقق من التوقيع (اختياري لكن مفيد للأمان)
$TOKEN = 'b750fdc9152f2462146603f298ff64dd2ef309598ab09e8f79442cab2192ea6f';

// استقبال البيانات من WasenderAPI
$input = file_get_contents('php://input');
$data = json_decode($input, true);

// تسجيل الطلب في ملف للاطمئنان
file_put_contents('webhook_log.txt', date('Y-m-d H:i:s') . " - " . $input . "\n", FILE_APPEND);

// التحقق من الحدث
if (isset($data['event']) && $data['event'] === 'messages.upsert') {
    $msg = $data['data'];
    $from = $msg['key']['remoteJid'] ?? '';
    $text = $msg['message']['conversation'] ?? '';
    $msgId = $msg['key']['id'] ?? '';

    // إذا كانت رسالة وسائط (صورة، فيديو) قد لا تحتوي على 'conversation'
    if (empty($text)) {
        $text = '📎 [وسائط]';
    }

    // تخزين الرسالة في ملف JSON
    $messagesFile = 'messages.json';
    $messages = [];
    if (file_exists($messagesFile)) {
        $messages = json_decode(file_get_contents($messagesFile), true) ?? [];
    }

    // إضافة الرسالة الجديدة
    $messages[] = [
        'id' => $msgId,
        'from' => $from,
        'text' => $text,
        'time' => date('Y-m-d H:i:s'),
        'is_replied' => false
    ];

    // حفظ الملف (نحتفظ بآخر 100 رسالة فقط عشان الملف ما يكبر)
    if (count($messages) > 100) {
        $messages = array_slice($messages, -100);
    }
    file_put_contents($messagesFile, json_encode($messages, JSON_PRETTY_PRINT));
}

// الرد بـ 200 OK عشان المنصة تعرف إن الاستلام تم
http_response_code(200);
echo json_encode(['status' => 'received']);
?>