type ResetEmailPayload = {
  to: string;
  resetToken: string;
  tenantId: string;
};

export const sendPasswordResetEmail = async (payload: ResetEmailPayload) => {
  const { to, resetToken, tenantId } = payload;
  console.log("[email] password reset requested", {
    tenantId,
    to,
    resetTokenMasked: `${resetToken.slice(0, 6)}...${resetToken.slice(-4)}`,
  });
};
