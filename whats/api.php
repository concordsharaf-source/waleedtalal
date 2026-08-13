<?php
// ============================================================
// api.php - الخادوم الخلفي الموحد
// ============================================================

// 🔴 ضع التوكن هنا
$TOKEN = 'b750fdc9152f2462146603f298ff64dd2ef309598ab09e8f79442cab2192ea6f';

// تحديد نوع العملية من الطلب
$action = $_GET['action'] ?? '';

// وظيفة مساعدة لإرسال طلبات cURL
function callWasenderAPI($url, $method = 'GET', $body = null) {
    global $TOKEN;
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $TOKEN,
        'Content-Type: application/json'
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $response = curl_exec($ch);
    curl_close($ch);
    return json_decode($response, true);
}

// ============================================================
// 1. إرسال رسالة
// ============================================================
if ($action === 'send') {
    $to = $_POST['to'] ?? '';
    $text = $_POST['text'] ?? '';
    $replyTo = $_POST['replyTo'] ?? null;

    if (!$to || !$text) {
        echo json_encode(['success' => false, 'message' => 'الرجاء إدخال جميع البيانات']);
        exit;
    }

    // التأكد من صيغة JID
    if (strpos($to, '@') === false) {
        $to = $to . '@s.whatsapp.net';
    }

    $payload = ['to' => $to, 'text' => $text];
    if ($replyTo) {
        $payload['replyTo'] = $replyTo;
    }

    $result = callWasenderAPI('https://www.wasenderapi.com/api/send-message', 'POST', $payload);
    echo json_encode($result);
    exit;
}

// ============================================================
// 2. جلب جهات الاتصال
// ============================================================
if ($action === 'contacts') {
    $result = callWasenderAPI('https://www.wasenderapi.com/api/contacts');
    echo json_encode($result);
    exit;
}

// ============================================================
// 3. جلب المجموعات
// ============================================================
if ($action === 'groups') {
    $result = callWasenderAPI('https://www.wasenderapi.com/api/groups');
    echo json_encode($result);
    exit;
}

// ============================================================
// 4. جلب الرسائل المخزنة (من webhook)
// ============================================================
if ($action === 'get_messages') {
    $file = 'messages.json';
    if (file_exists($file)) {
        $content = file_get_contents($file);
        $messages = json_decode($content, true) ?? [];
        // نعرض آخر 20 رسالة فقط (الأحدث في الأعلى)
        $messages = array_reverse($messages);
        $messages = array_slice($messages, 0, 20);
        echo json_encode(['success' => true, 'data' => $messages]);
    } else {
        echo json_encode(['success' => true, 'data' => []]);
    }
    exit;
}

// إذا لم يتم تحديد أي إجراء
echo json_encode(['success' => false, 'message' => 'إجراء غير معروف']);
?>