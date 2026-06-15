export type DeleteAccountConfirmationCopyKeys = {
  impactBodyKey: string;
  finalBodyKey: string;
};

export function getDeleteAccountConfirmationCopyKeys(
  deleteMayIncludeBusinessData: boolean,
): DeleteAccountConfirmationCopyKeys {
  return deleteMayIncludeBusinessData
    ? {
        impactBodyKey: "deleteAccount.body",
        finalBodyKey: "deleteAccount.finalBusinessBody",
      }
    : {
        impactBodyKey: "deleteAccount.bodyConsumer",
        finalBodyKey: "deleteAccount.finalConsumerBody",
      };
}
