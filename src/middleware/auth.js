const jwt=require('jsonwebtoken'); const User=require('../models/User')
exports.protect=async(req,res,next)=>{try{const token=req.headers.authorization?.replace('Bearer ',''); if(!token) return res.status(401).json({success:false,message:'Authentication required'}); const payload=jwt.verify(token,process.env.JWT_SECRET||'change_this_local_shop_report_secret'); const user=await User.findById(payload.id); if(!user||user.status!=='ACTIVE') return res.status(401).json({success:false,message:'Session is no longer valid'}); req.user=user;next()}catch{res.status(401).json({success:false,message:'Invalid or expired session'})}}
const roleAliases={ADMIN:['ADMIN','OWNER'],STAFF:['STAFF','CASHIER'],MANAGER:['MANAGER']}
exports.hasRole=(user,...roles)=>roles.some(role=>(roleAliases[role]||[role]).includes(user.role))
exports.allow=(...roles)=>(req,res,next)=>exports.hasRole(req.user,...roles)?next():res.status(403).json({success:false,message:'You do not have permission for this action'})
