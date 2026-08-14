const { Schema, model } = require('mongoose')
const userSchema = new Schema({
  fullName:{type:String,trim:true},
  name:{type:String,required:true,trim:true},
  phoneNumber:{type:String,trim:true,unique:true,sparse:true},
  pinHash:{type:String,required:true,select:false},
  role:{type:String,enum:['ADMIN','OWNER','MANAGER','CASHIER','STAFF'],default:'STAFF'},
  status:{type:String,enum:['ACTIVE','INACTIVE'],default:'ACTIVE'},
  lastLogin:Date,
  createdBy:{type:Schema.Types.ObjectId,ref:'User'},
},{timestamps:true})
userSchema.pre('validate',function(){if(!this.name&&this.fullName)this.name=this.fullName;if(!this.fullName&&this.name)this.fullName=this.name})
module.exports=model('User',userSchema)
