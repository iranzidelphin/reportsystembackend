const {z}=require('zod'),Service=require('../models/Service'),Expense=require('../models/Expense'),Product=require('../models/Product'),Transaction=require('../models/Transaction'),User=require('../models/User'),ActivityLog=require('../models/ActivityLog'),{asyncHandler,log,dateFilter}=require('../utils'),{ensureDefaultAdmin,isDefaultAdmin}=require('../utils/defaultAdmin')
const serviceRule=z.object({name:z.string().trim().min(1),type:z.enum(['SERVICE','PRODUCT']),category:z.string().trim().optional().default(''),defaultPrice:z.coerce.number().min(0).optional(),price:z.coerce.number().min(0).optional(),active:z.boolean().optional()}).transform(v=>({...v,price:v.price??v.defaultPrice,defaultPrice:v.defaultPrice??v.price})); const expenseRule=z.object({description:z.string().trim().min(1),amount:z.coerce.number().positive(),paymentMethod:z.enum(['CASH','MOMO']).default('CASH')}).transform(v=>({...v,date:new Date(),expenseDate:new Date()}))
const crud=(Model,rule,label,owner=false,dateField='createdAt')=>({list:asyncHandler(async(req,res)=>res.json({success:true,data:await Model.find(dateFilter(req.query,dateField)).sort({[dateField]:-1,createdAt:-1}).populate('createdBy','name fullName phoneNumber')})),create:asyncHandler(async(req,res)=>{const p=rule.safeParse(req.body);if(!p.success)return res.status(400).json({success:false,message:'Validation failed',errors:p.error.issues});const data=await Model.create(owner?{...p.data,createdBy:req.user._id}:p.data);await data.populate('createdBy','name fullName phoneNumber');await log(req.user,`CREATE_${label}`,`Created ${label.toLowerCase()}`);res.status(201).json({success:true,data})}),update:asyncHandler(async(req,res)=>{const p=rule.safeParse(req.body);if(!p.success)return res.status(400).json({success:false,message:'Validation failed',errors:p.error.issues});const existing=await Model.findById(req.params.id);if(!existing)return res.status(404).json({success:false,message:`${label} not found`});if(owner&&String(existing.createdBy)!==String(req.user._id))return res.status(403).json({success:false,message:`You can only edit ${label.toLowerCase()} rows you personally created.`});const data=await Model.findByIdAndUpdate(existing._id,p.data,{returnDocument:'after'}).populate('createdBy','name fullName phoneNumber');res.json({success:true,data})}),remove:asyncHandler(async(req,res)=>{const existing=await Model.findById(req.params.id);if(!existing)return res.status(404).json({success:false,message:`${label} not found`});if(owner&&String(existing.createdBy)!==String(req.user._id))return res.status(403).json({success:false,message:`You can only delete ${label.toLowerCase()} rows you personally created.`});await Model.findByIdAndDelete(existing._id);res.json({success:true,message:`${label} deleted`})})})
exports.services=crud(Service,serviceRule,'SERVICE');
const importRule=z.object({description:z.string().trim().min(1),amount:z.coerce.number().positive(),paymentMethod:z.enum(['CASH','MOMO']).default('CASH'),productId:z.string().refine(v=>require('mongoose').Types.ObjectId.isValid(v),'Invalid product').optional().or(z.literal('')),stockQuantity:z.coerce.number().int().min(0).optional().default(0)})
const reverseImport = async (productId, quantity) => {
  if (!productId || !quantity) return true
  return Boolean(await Product.findOneAndUpdate(
    { _id: productId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity } },
    { new: true },
  ))
}
const addImportedQuantity = async (productId, quantity) => {
  if (!productId || !quantity) return true
  return Boolean(await Product.findByIdAndUpdate(productId, { $inc: { quantity } }, { new: true }))
}
exports.expenses={
 list:asyncHandler(async(req,res)=>{const query=dateFilter(req.query,'expenseDate');res.json({success:true,data:await Expense.find(query).sort({expenseDate:-1,createdAt:-1}).populate('createdBy','name fullName phoneNumber').populate('productId','name sku')})}),
 create:asyncHandler(async(req,res)=>{const p=importRule.safeParse(req.body);if(!p.success)return res.status(400).json({success:false,message:'Validation failed',errors:p.error.issues});const d=p.data,productId=d.productId||null;const product=productId?await Product.findById(productId):null;if(productId&&!product)return res.status(404).json({success:false,message:'Product not found'});if(productId&&!await addImportedQuantity(productId,d.stockQuantity))return res.status(404).json({success:false,message:'Product not found'});let data;try{data=await Expense.create({description:d.description,amount:d.amount,paymentMethod:d.paymentMethod,productId,stockQuantity:d.stockQuantity,createdBy:req.user._id})}catch(error){if(productId)await reverseImport(productId,d.stockQuantity);throw error}await log(req.user,'CREATE_EXPENSE','Imported stock');res.status(201).json({success:true,data})}),
 update:asyncHandler(async(req,res)=>{const p=importRule.safeParse(req.body);if(!p.success)return res.status(400).json({success:false,message:'Validation failed',errors:p.error.issues});const existing=await Expense.findById(req.params.id);if(!existing)return res.status(404).json({success:false,message:'EXPENSE not found'});if(String(existing.createdBy)!==String(req.user._id))return res.status(403).json({success:false,message:'You can only edit expense rows you personally created.'});const d=p.data,nextProductId=d.productId||null,nextProduct=nextProductId?await Product.findById(nextProductId):null;if(nextProductId&&!nextProduct)return res.status(404).json({success:false,message:'Product not found'});const oldProductId=existing.productId?String(existing.productId):null,sameProduct=oldProductId&&oldProductId===String(nextProductId||''),oldQuantity=Number(existing.stockQuantity||0),newQuantity=Number(d.stockQuantity||0);let reversed=false,added=false;const quantityToReverse=sameProduct?Math.max(0,oldQuantity-newQuantity):oldQuantity,quantityToAdd=sameProduct?Math.max(0,newQuantity-oldQuantity):newQuantity;if(oldProductId&&quantityToReverse){reversed=await reverseImport(oldProductId,quantityToReverse);if(!reversed)return res.status(409).json({success:false,message:'This import cannot be reversed because some of its stock has already been sold or removed.'})}try{if(nextProductId&&quantityToAdd){added=await addImportedQuantity(nextProductId,quantityToAdd);if(!added)throw Object.assign(new Error('Product not found'),{status:404})}const data=await Expense.findByIdAndUpdate(existing._id,{description:d.description,amount:d.amount,paymentMethod:d.paymentMethod,productId:nextProductId,stockQuantity:newQuantity},{new:true,runValidators:true});if(!data)throw Object.assign(new Error('Import record not found'),{status:404});res.json({success:true,data})}catch(error){if(added)await reverseImport(nextProductId,quantityToAdd);if(reversed)await addImportedQuantity(oldProductId,quantityToReverse);throw error}}),
 remove:asyncHandler(async(req,res)=>{const existing=await Expense.findOne({_id:req.params.id,});if(!existing)return res.status(404).json({success:false,message:'EXPENSE not found'});if(String(existing.createdBy)!==String(req.user._id))return res.status(403).json({success:false,message:'You can only delete expense rows you personally created.'});if(existing.productId&&!await reverseImport(existing.productId,existing.stockQuantity))return res.status(409).json({success:false,message:'This import cannot be reversed because some of its stock has already been sold or removed.'});try{await existing.deleteOne()}catch(error){if(existing.productId)await addImportedQuantity(existing.productId,existing.stockQuantity);throw error}res.json({success:true,message:'EXPENSE deleted'})})
}
const scope=(_req,q={})=>q
exports.dashboard=asyncHandler(async(req,res)=>{
 const isAdmin=['ADMIN','OWNER'].includes(req.user.role)
 const q=dateFilter(req.query)
 if(!isAdmin)q.$or=[{staff:req.user._id},{createdBy:req.user._id}]
 const [t,lowStockProducts]=await Promise.all([
  Transaction.aggregate([{$match:q},{$group:{_id:null,totalPaid:{$sum:'$paidAmount'},totalCashOut:{$sum:{$ifNull:['$cashOut',0]}},totalCashIn:{$sum:{$subtract:['$paidAmount',{$ifNull:['$cashOut',0]}]}},totalRemaining:{$sum:'$remainingAmount'},transactionCount:{$sum:1}}}]),
  isAdmin?Product.find({$expr:{$lte:['$quantity','$lowStockLevel']},status:'ACTIVE'}).sort({quantity:1}).limit(10).select('name sku quantity lowStockLevel location'):Promise.resolve([]),
 ])
 const s=t[0]||{}
 const data={paidAmount:s.totalPaid||0,totalPaid:s.totalPaid||0,totalAmount:s.totalPaid||0,totalCashOut:s.totalCashOut||0,totalCashIn:s.totalCashIn||0,totalMoneyEarned:s.totalCashIn||0,notPaid:s.totalRemaining||0,totalRemaining:s.totalRemaining||0,totalRemainingMoney:s.totalRemaining||0,transactionCount:s.transactionCount||0}
 if(isAdmin)data.lowStockProducts=lowStockProducts
 res.json({success:true,data})
})
exports.report=asyncHandler(async(req,res)=>{
  const q=scope(req,dateFilter(req.query))
  if(req.query.paymentMethod)q.paymentMethod=req.query.paymentMethod
  if(req.query.userId){
    if(!['ADMIN','OWNER'].includes(req.user.role))return res.status(403).json({success:false,message:'Only administrators can filter sales by user.'})
    if(!/^[a-f\d]{24}$/i.test(req.query.userId))return res.status(400).json({success:false,message:'Invalid user ID.'})
    q.$or=[{staff:req.query.userId},{createdBy:req.query.userId}]
  }
  const [transactions,total,bestSellingProducts,currentStock,salesByUser]=await Promise.all([
    Transaction.find(q).populate('staff','name fullName phoneNumber role').populate('productId','name sku').sort({transactionDate:-1}),
    Transaction.aggregate([{$match:q},{$group:{_id:null,amount:{$sum:'$paidAmount'},cashOut:{$sum:{$ifNull:['$cashOut',0]}},cashIn:{$sum:{$subtract:['$paidAmount',{$ifNull:['$cashOut',0]}]}},remaining:{$sum:'$remainingAmount'},cash:{$sum:{$cond:[{$eq:['$paymentMethod','CASH']},'$paidAmount',0]}},momo:{$sum:{$cond:[{$eq:['$paymentMethod','MOMO']},'$paidAmount',0]}},count:{$sum:1}}}]),
    Transaction.aggregate([{$match:{...q,productId:{$ne:null}}},{$group:{_id:'$productId',quantitySold:{$sum:'$quantity'},sales:{$sum:'$totalAmount'}}},{$sort:{quantitySold:-1}},{$limit:10},{$lookup:{from:'products',localField:'_id',foreignField:'_id',as:'product'}},{$unwind:'$product'},{$project:{_id:0,productId:'$_id',name:'$product.name',sku:'$product.sku',quantitySold:1,sales:1}}]),
    Product.aggregate([{$match:{}},{$group:{_id:null,value:{$sum:{$multiply:['$quantity','$costPrice']}}}}]),
    Transaction.aggregate([{$match:q},{$group:{_id:{$ifNull:['$staff','$createdBy']},transactions:{$sum:1},sales:{$sum:'$paidAmount'},cashOut:{$sum:{$ifNull:['$cashOut',0]}},cashIn:{$sum:{$subtract:['$paidAmount',{$ifNull:['$cashOut',0]}]}}}},{$lookup:{from:'users',localField:'_id',foreignField:'_id',as:'user'}},{$unwind:{path:'$user',preserveNullAndEmptyArrays:true}},{$project:{_id:0,userId:'$_id',name:{$ifNull:['$user.fullName',{$ifNull:['$user.name','Unknown user']}]},transactions:1,sales:1,cashOut:1,cashIn:1}},{$sort:{sales:-1}}]),
  ])
  const t=total[0]||{}
  res.json({success:true,data:{period:{fromDate:req.query.fromDate||null,toDate:req.query.toDate||null},totalTransactions:t.count||0,totalAmount:t.amount||0,totalCashOut:t.cashOut||0,totalCashIn:t.cashIn||0,totalMoneyEarned:t.cashIn||0,totalRemainingMoney:t.remaining||0,totalPaid:t.amount||0,totalRemaining:t.remaining||0,totalCash:t.cash||0,totalMomo:t.momo||0,transactions,bestSellingProducts,salesByUser,currentStockValue:currentStock[0]?.value||0}})
})
const userFields = z.object({
  name: z.string().trim().min(1), phoneNumber: z.string().trim().min(7),
  role: z.enum(['MANAGER', 'STAFF', 'CASHIER']).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  password: z.string().min(1).optional(),
})
const userRule = z.object({ name: z.string().trim().min(1).optional(), phoneNumber: z.string().trim().min(7).optional(), role: z.enum(['MANAGER', 'STAFF', 'CASHIER']).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), password: z.string().min(1).optional() })
const DEFAULT_USER_PASSWORD = '123456'
const safeUser = (user) => ({ id: user._id, _id: user._id, fullName: user.fullName, name: user.name, phoneNumber: user.phoneNumber, role: user.role, status: user.status, createdAt: user.createdAt })
exports.users = {
  list: asyncHandler(async (req, res) => {
    await ensureDefaultAdmin()
    const data = await User.find().sort({ createdAt: -1 })
    res.json({ success: true, data: data.map(safeUser) })
  }),
  create: asyncHandler(async (req, res) => {
    const parsed = userFields.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
    const bcrypt = require('bcryptjs')
    const name = parsed.data.name
    let data
    try { data = await User.create({ fullName: name, name, phoneNumber: parsed.data.phoneNumber, passwordHash: await bcrypt.hash(DEFAULT_USER_PASSWORD, 12), role: parsed.data.role || 'STAFF', status: parsed.data.status || 'ACTIVE', createdBy: req.user._id }) }
    catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: 'An account with this phone number already exists.' }); throw error }
    await log(req.user, 'CREATE_USER', `Created ${data.role.toLowerCase()} ${data.name}`)
    res.status(201).json({ success: true, data: { ...safeUser(data), defaultPassword: DEFAULT_USER_PASSWORD } })
  }),
  update: asyncHandler(async (req, res) => {
    const existing = await User.findById(req.params.id)
    if (!existing) return res.status(404).json({ success: false, message: 'User not found' })
    if (isDefaultAdmin(existing)) return res.status(403).json({ success: false, message: 'Default admin cannot be edited.' })
    const parsed = userRule.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
    const update = {}
    if (parsed.data.name) update.fullName = update.name = parsed.data.name
    if (parsed.data.phoneNumber) update.phoneNumber = parsed.data.phoneNumber
    if (parsed.data.password) update.passwordHash = await require('bcryptjs').hash(parsed.data.password, 12)
    if (parsed.data.role) update.role = parsed.data.role
    if (parsed.data.status) update.status = parsed.data.status
    let data
    try { data = await User.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after', runValidators: true }) }
    catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: 'An account with this phone number already exists.' }); throw error }
    await log(req.user, 'UPDATE_USER', `Updated user ${data.name}`)
    res.json({ success: true, data: safeUser(data) })
  }),
  remove: asyncHandler(async (req, res) => {
    const existing = await User.findById(req.params.id)
    if (!existing) return res.status(404).json({ success: false, message: 'User not found' })
    if (isDefaultAdmin(existing)) return res.status(403).json({ success: false, message: 'Default admin cannot be deleted.' })
    await User.findByIdAndDelete(req.params.id)
    await log(req.user, 'DELETE_USER', `Deleted user ${existing.name}`)
    res.json({ success: true, message: 'User deleted' })
  }),
}
exports.logs=asyncHandler(async(req,res)=>{const page=Number(req.query.page||1),limit=Number(req.query.limit||20);const [data,total]=await Promise.all([ActivityLog.find().populate('user','name role').sort({timestamp:-1}).skip((page-1)*limit).limit(limit),ActivityLog.countDocuments()]);res.json({success:true,data,meta:{page,limit,total,pages:Math.ceil(total/limit)}})})
