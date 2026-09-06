export const NEW_PASSWORD_HINT = '8–32 位，必须同时包含英文字母和数字';
export const NEW_PASSWORD_PATTERN = '(?=[\\s\\S]*[A-Za-z])(?=[\\s\\S]*[0-9])[\\s\\S]{8,32}';
const newPassword = new RegExp(`^(?:${NEW_PASSWORD_PATTERN})$`, 'u');
export const isNewPasswordValid = (value: string) => newPassword.test(value);
