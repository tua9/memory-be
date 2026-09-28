import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    passwordHash: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ['active', 'inactive', 'banned'],
      default: 'active',
    },

    
    role: {
      type: String,
      enum: [
            "user",
            "admin"
      ],
      default: 'user'
    },

  },
  {
  
    timestamps: true,
  },
)

export default mongoose.model('user', userSchema)
