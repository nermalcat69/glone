# Glone

A smart VS Code extension that adds a status bar button to clone git repositories directly from your clipboard with intelligent conflict detection.

## Features

- **Smart Clipboard Detection**: Automatically detects git repository URLs (GitHub, GitLab, Bitbucket, etc.) in your clipboard
- **Intelligent Conflict Prevention**: Automatically detects existing project files to avoid conflicts
- **Status Bar Integration**: Shows a convenient clone button in the status bar when a valid git URL is detected
- **One-Click Cloning**: Click the status bar button to clone the repository from your clipboard
- **Clean Architecture**: Built with OOP principles and TypeScript best practices
- **Auto-Open Option**: Optionally open the cloned repository in a new VS Code window

## Supported Git Providers

- **Popular Hosted Services**: GitHub, GitLab, Bitbucket
- **Self-Hosted Git Instances**: GitLab, Gitea, Gitiles, cgit, and custom Git servers
- **Multiple URL Formats**:
  - HTTPS: `https://git.example.com/user/repo.git`
  - SSH: `git@git.example.com:user/repo.git`
  - Git Protocol: `git://git.example.com/user/repo.git`
- **Common Self-Hosted Patterns**:
  - `https://git.company.com/repos/project.git`
  - `https://code.company.com/scm/project.git`
  - `https://gitlab.company.com/group/project.git`

## How to Use

1. Copy a git repository URL to your clipboard (e.g., `https://github.com/user/repo`)
2. The status bar will show a clone button: `🔗 Clone: repo-name`
3. Click the button to clone the repository
4. The extension automatically detects if your workspace has existing project files:
   - **Empty/Clean workspace**: Clones directly to workspace root
   - **Existing project detected**: Clones to a new folder with the repository name (avoids conflicts)
5. You'll have the option to reload the window or open the cloned repository

## Smart Conflict Detection

The extension automatically detects common project files and directories to prevent conflicts:

- **Configuration files**: `package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, etc.
- **Lock files**: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, etc.
- **Documentation**: `README.md`, `LICENSE`, etc.
- **Common directories**: `src/`, `lib/`, `dist/`, `node_modules/`, `.git/`, etc.

When these files are detected, the repository is cloned to a separate folder to avoid overwriting your existing work.

## Installation

Install from VS Code Extensions marketplace (Ctrl+Shift+X) by searching for "Glone".

## Requirements

- Git must be installed and available in your system PATH
- VS Code 1.60.0 or higher

## Contributing

Found a bug or have a feature request? Please open an issue on [GitHub](https://github.com/nermalcat69/glone/issues).

## License

This extension is licensed under the MIT License. See the [LICENSE](https://github.com/nermalcat69/glone/blob/main/LICENSE) file for details.
