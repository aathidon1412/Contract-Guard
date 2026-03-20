import { Octokit } from "@octokit/rest";

import AppError from "../utils/AppError";

interface RepoInfo {
  name: string;
  fullName: string;
  githubUrl: string;
  description: string;
  language: string;
}

interface RepoBranch {
  name: string;
  type: "main" | "branch";
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const parseGithubUrl = (url: string): { owner: string; repo: string } => {
  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);

  if (!match) {
    throw new AppError("Invalid GitHub URL format", 400);
  }

  return {
    owner: match[1],
    repo: match[2],
  };
};

const getRepoInfo = async (githubUrl: string): Promise<RepoInfo> => {
  const { owner, repo } = parseGithubUrl(githubUrl);

  try {
    const response = await octokit.repos.get({ owner, repo });

    return {
      name: response.data.name,
      fullName: response.data.full_name,
      githubUrl: response.data.html_url,
      description: response.data.description ?? "",
      language: response.data.language ?? "",
    };
  } catch {
    throw new AppError("GitHub repository not found or inaccessible", 404);
  }
};

const getBranches = async (owner: string, repo: string): Promise<RepoBranch[]> => {
  try {
    const response = await octokit.repos.listBranches({ owner, repo });

    return response.data.map((branch) => ({
      name: branch.name,
      type:
        branch.name === "main" || branch.name === "master" || branch.name === "develop"
          ? "main"
          : "branch",
    }));
  } catch {
    throw new AppError("Failed to fetch repository branches", 502);
  }
};

const getFileContent = async (
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): Promise<string> => {
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });

    if (Array.isArray(response.data) || response.data.type !== "file") {
      throw new AppError("Requested path is not a file", 400);
    }

    const content = response.data.content ?? "";
    return Buffer.from(content, "base64").toString("utf-8");
  } catch {
    throw new AppError("Failed to fetch file content", 502);
  }
};

const getRepoFiles = async (owner: string, repo: string, branch: string): Promise<string[]> => {
  try {
    const branchResponse = await octokit.repos.getBranch({
      owner,
      repo,
      branch,
    });

    const treeResponse = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: branchResponse.data.commit.sha,
      recursive: "true",
    });

    const supportedExtensions = [".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go"];

    return treeResponse.data.tree
      .filter((item) => item.type === "blob" && typeof item.path === "string")
      .map((item) => item.path as string)
      .filter((path) => supportedExtensions.some((ext) => path.toLowerCase().endsWith(ext)));
  } catch {
    throw new AppError("Failed to fetch repository files", 502);
  }
};

const getDefaultBranch = async (owner: string, repo: string): Promise<string> => {
  try {
    const response = await octokit.repos.get({ owner, repo });
    return response.data.default_branch;
  } catch {
    throw new AppError("Failed to fetch default branch", 502);
  }
};

const githubService = {
  octokit,
  getRepoInfo,
  getBranches,
  getFileContent,
  getRepoFiles,
  getDefaultBranch,
  parseGithubUrl,
};

export default githubService;