import prisma from "../lib/prisma";

const scanBranch = async (branchId: number) => {
  const totalApis = await prisma.apiEndpoint.count({
    where: { branchId },
  });

  return {
    totalApis,
    lastScanned: new Date(),
  };
};

export default {
  scanBranch,
};