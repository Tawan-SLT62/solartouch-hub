// ตั้งค่าการเชื่อมต่อ Firebase
// 1) คัดลอกค่าจาก Firebase Console → Project settings → Your apps → Web app (SDK setup and configuration → Config)
//    ค่าเหล่านี้เป็นค่าสาธารณะของเว็บแอป ใส่ใน GitHub ได้ ความปลอดภัยของข้อมูลมาจากไฟล์ firestore.rules
// 2) รายชื่อผู้ดูแลระบบอยู่ในกฎ firestore.rules ใน Firebase Console (ไม่ต้องใส่ที่นี่ เพราะไฟล์นี้เป็นสาธารณะ)
//
// ถ้า apiKey ยังว่าง เว็บจะเปิดใน "โหมดตัวอย่าง" ที่ไม่บันทึกข้อมูล
window.SOLARTOUCH_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAii_xQG2zkIbh_m8yKCRPrtwYgf34AEtc",
    authDomain: "solartouch-hub.firebaseapp.com",
    projectId: "solartouch-hub",
    storageBucket: "solartouch-hub.firebasestorage.app",
    messagingSenderId: "397961316003",
    appId: "1:397961316003:web:6cf3873cf3b9fb6e0da116"
  },
  adminEmails: [
  ]
};
