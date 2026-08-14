const { Schema, model } = require('mongoose')
const schema = new Schema({
  saleId:{type:String,unique:true,sparse:true},
  staff:{type:Schema.Types.ObjectId,ref:'User'},
  customerName:{type:String,trim:true,default:''},
  productOrService:{type:String,trim:true},
  serviceOrProduct:{type:String,required:true,trim:true},
  category:{type:String,trim:true,default:''},
  quantity:{type:Number,required:true,min:1,default:1},
  unitPrice:{type:Number,required:true,min:0,default:0},
  totalAmount:{type:Number,required:true,min:0},
  paidAmount:{type:Number,required:true,min:0},
  remainingAmount:{type:Number,required:true,min:0},
  paymentMethod:{type:String,enum:['CASH','MOMO','CARD','BANK','OTHER'],default:'OTHER'},
  paymentStatus:{type:String,enum:['PAID','PARTIALLY_PAID','MONEY_NOT_PAID'],required:true},
  submissionStatus:{type:String,enum:['SUBMITTED','APPROVED','REJECTED'],default:'SUBMITTED'},
  notes:{type:String,trim:true,default:''},
  rejectionReason:{type:String,trim:true,default:''},
  saleDate:{type:Date,required:true,default:Date.now},
  saleTime:{type:String,trim:true},
  transactionDate:{type:Date,required:true,default:Date.now},
  createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
},{timestamps:true})
schema.pre('validate',function(){
  if(!this.serviceOrProduct&&this.productOrService)this.serviceOrProduct=this.productOrService
  if(!this.productOrService&&this.serviceOrProduct)this.productOrService=this.serviceOrProduct
  if(!this.transactionDate&&this.saleDate)this.transactionDate=this.saleDate
  if(!this.saleDate&&this.transactionDate)this.saleDate=this.transactionDate
  if(!this.staff&&this.createdBy)this.staff=this.createdBy
  if(!this.saleTime)this.saleTime=new Date(this.saleDate||this.transactionDate||Date.now()).toTimeString().slice(0,5)
  if(!this.saleId)this.saleId=`SALE-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`
})
schema.index({transactionDate:-1,paymentStatus:1,paymentMethod:1,staff:1}); module.exports=model('Transaction',schema)
