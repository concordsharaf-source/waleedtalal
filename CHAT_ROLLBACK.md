# نقطة التراجع قبل نظام المحادثة الداخلية

تم تثبيت النسخة السابقة قبل إضافة المحادثة الداخلية في Git tag باسم:

`before-internal-chat-2026-10-04`

والالتزام الأساسي هو:

`83b384739edc0c9da98bdf4586e4b18cbfaa33ff`

## الرجوع الكامل عند الحاجة

```bash
git checkout main
git reset --hard before-internal-chat-2026-10-04
git push --force-with-lease origin main
```

> تحذير: الرجوع الكامل يلغي كل التعديلات التي أُضيفت بعد نقطة التراجع، لذلك يجب استخدامه فقط بطلب مالك الموقع.

## الرجوع عن المحادثة مع الاحتفاظ بأي تغييرات أحدث

التزام إضافة نظام المحادثة هو:

`ae41d6de5220de9611191e0780c84917b127bb6b`

ولإلغائه مع الاحتفاظ بسجل Git:

```bash
git checkout main
git revert ae41d6de5220de9611191e0780c84917b127bb6b
git push origin main
```
