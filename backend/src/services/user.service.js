import bcrypt from 'bcrypt'
import User from '../models/users.js'
import { JwtProvider } from '../providers/JwtProvider.js'
import ApiError from '../utils/ApiError.js'




const signUp = async (body) => {
  const { email, password, fullName } = body

  const normalizedEmail = email.toLowerCase().trim()
  const existingUser = await User.findOne({ email: normalizedEmail })

  // Đã có tài khoản ĐÃ xác thực -> email thực sự bị trùng
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already exists')
  }

  const passwordHash = await bcrypt.hash(password, 10)

  // Tồn tại nhưng CHƯA xác thực -> cập nhật lại thông tin (cho phép đăng ký lại).
  // Chưa tồn tại -> tạo mới ở trạng thái chưa xác thực.
  if (existingUser) {
    existingUser.fullName = fullName
    existingUser.passwordHash = passwordHash
    await existingUser.save()
  } else {
    await User.create({
      email: normalizedEmail,
      fullName,
      passwordHash,
      status: 'active',
    })
  }
}