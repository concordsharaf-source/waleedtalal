<?php
$file = 'messages.json';
if (file_exists($file)) {
    file_put_contents($file, json_encode([]));
    echo json_encode(['success' => true]);
} else {
    echo json_encode(['success' => false, 'message' => 'الملف غير موجود']);
}
?>
