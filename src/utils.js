const ActivityLog=require('./models/ActivityLog')
exports.asyncHandler=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)
exports.log=(user,action,description)=>ActivityLog.create({user:user?._id||user,action,description})
exports.dateFilter=(query,field='transactionDate')=>{const filter={}; if(query.fromDate||query.toDate){filter[field]={};if(query.fromDate)filter[field].$gte=new Date(`${query.fromDate}T00:00:00.000Z`);if(query.toDate)filter[field].$lte=new Date(`${query.toDate}T23:59:59.999Z`)}return filter}
exports.statusFor=(total,paid)=>paid===0?'MONEY_NOT_PAID':paid>=total?'PAID':'PARTIALLY_PAID'
