// ตั้งค่าการเชื่อมต่อ Firebase
// 1) คัดลอกค่าจาก Firebase Console → Project settings → Your apps → Web app (SDK setup and configuration → Config)
//    ค่าเหล่านี้เป็นค่าสาธารณะของเว็บแอป ใส่ใน GitHub ได้ ความปลอดภัยของข้อมูลมาจากไฟล์ firestore.rules
// 2) ใส่อีเมล Gmail ของผู้ดูแลระบบใน adminEmails (ต้องตรงกับในไฟล์ firestore.rules)
//
// ถ้า apiKey ยังว่าง เว็บจะเปิดใน "โหมดตัวอย่าง" ที่ไม่บันทึกข้อมูล
window.SOLARTOUCH_CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  adminEmails: [
    // "your.name@gmail.com"
  ]
};
