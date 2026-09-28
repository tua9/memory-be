import JWT from 'jsonwebtoken'

const generateToken = async (userInfo, secretKey, tokenLife) => {
  return JWT.sign(userInfo, secretKey, {
    algorithm: 'HS256',
    expiresIn: tokenLife,
  })
}

const verifyToken = async (token, secretKey) => {
  // Giữ nguyên error gốc (TokenExpiredError / JsonWebTokenError) để nơi gọi
  // có thể phân biệt qua err.name thay vì chỉ dựa vào message.
  return JWT.verify(token, secretKey)
}

export const JwtProvider = {
  generateToken,
  verifyToken,
}