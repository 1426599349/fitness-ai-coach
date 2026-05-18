/**
 * 微信登录 + 鉴权模块
 */
const app = getApp();

/**
 * 获取当前用户openid
 */
function getOpenid() {
  return app.globalData.openid;
}

/**
 * 检查是否已登录
 */
function isLoggedIn() {
  return app.globalData.isLoggedIn;
}

/**
 * 检查是否为新用户
 */
function isNewUser() {
  return app.globalData.isNewUser;
}

/**
 * 获取用户档案（从缓存）
 */
function getUserProfile() {
  return app.globalData.userProfile;
}

/**
 * 更新本地用户档案缓存
 */
function updateUserProfile(profile) {
  app.globalData.userProfile = profile;
  app.globalData.isNewUser = false;
}

/**
 * 等待登录完成的Promise
 */
function waitForLogin() {
  return new Promise((resolve) => {
    if (app.globalData.isLoggedIn) {
      resolve(app.globalData.openid);
      return;
    }
    // 轮询等待
    const check = setInterval(() => {
      if (app.globalData.openid) {
        clearInterval(check);
        resolve(app.globalData.openid);
      }
    }, 200);
    // 超时
    setTimeout(() => {
      clearInterval(check);
      resolve(null);
    }, 5000);
  });
}

module.exports = {
  getOpenid,
  isLoggedIn,
  isNewUser,
  getUserProfile,
  updateUserProfile,
  waitForLogin,
};
