import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ================================
// Types and Interfaces
// ================================

interface GitRepository {
    url: string;
    name: string;
    normalizedUrl: string;
}

interface CloneLocation {
    targetPath: string;
    cloneToRoot: boolean;
    message: string;
}

interface ProjectFileDetectionResult {
    hasCommonFiles: boolean;
    detectedFiles: string[];
}

interface CloneResult {
    success: boolean;
    message: string;
    targetPath?: string;
}

// ================================
// Constants and Configuration
// ================================

class ProjectFilePatterns {
    static readonly COMMON_FILES = [
        'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
        'composer.json', 'Gemfile', 'requirements.txt', 'Pipfile',
        'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
        'Makefile', 'CMakeLists.txt', 'tsconfig.json', 'jsconfig.json',
        '.gitignore', 'README.md', 'README.rst', 'README.txt',
        'LICENSE', 'LICENSE.txt', 'LICENSE.md',
        '.env', '.env.example', 'docker-compose.yml', 'Dockerfile', '.git'
    ] as const;

    static readonly COMMON_DIRECTORIES = [
        'src', 'lib', 'dist', 'build', 'out', 'target', 'bin',
        'node_modules', '.git', '.vscode', 'test', 'tests', 'spec',
        'docs', 'public', 'assets', 'static'
    ] as const;
}

class GitProviderPatterns {
    static readonly PATTERNS = [
        // Popular hosted providers
        /^https?:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+(?:\.git)?\/?$/,
        /^https?:\/\/gitlab\.com\/[\w\-\.]+\/[\w\-\.]+(?:\.git)?\/?$/,
        /^https?:\/\/bitbucket\.org\/[\w\-\.]+\/[\w\-\.]+(?:\.git)?\/?$/,
        
        // Self-hosted Git instances (common patterns)
        /^https?:\/\/git\.[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/gitlab\.[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/gitea\.[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/gitiles\.[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/cgit\.[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        
        // Generic self-hosted patterns
        /^https?:\/\/[\w\-\.]+\/[\w\-\.\/]+\.git\/?$/,
        /^https?:\/\/[\w\-\.]+\/git\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/[\w\-\.]+\/repos?\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/[\w\-\.]+\/scm\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^https?:\/\/[\w\-\.]+\/projects\/[\w\-\.\/]+(?:\.git)?\/?$/,
        
        // SSH URLs for popular providers
        /^git@github\.com:[\w\-\.]+\/[\w\-\.]+\.git$/,
        /^git@gitlab\.com:[\w\-\.]+\/[\w\-\.]+\.git$/,
        /^git@bitbucket\.org:[\w\-\.]+\/[\w\-\.]+\.git$/,
        
        // SSH URLs for self-hosted
        /^git@[\w\-\.]+:[\w\-\.\/]+\.git$/,
        /^[\w\-\.]+@[\w\-\.]+:[\w\-\.\/]+\.git$/,
        
        // Alternative SSH formats
        /^ssh:\/\/git@[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        /^ssh:\/\/[\w\-\.]+@[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/,
        
        // Git protocol
        /^git:\/\/[\w\-\.]+\/[\w\-\.\/]+(?:\.git)?\/?$/
    ] as const;
}

// ================================
// Core Services
// ================================

class GitUrlValidator {
    static isValid(url: string): boolean {
        if (!url?.trim()) return false;
        return GitProviderPatterns.PATTERNS.some(pattern => pattern.test(url.trim()));
    }

    static normalize(url: string): string {
        const trimmedUrl = url.trim();
        
        // SSH URLs and git:// URLs are already in correct format
        if (trimmedUrl.startsWith('git@') || 
            trimmedUrl.startsWith('ssh://') || 
            trimmedUrl.startsWith('git://')) {
            return trimmedUrl;
        }
        
        // Handle HTTPS URLs
        if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
            // Remove trailing slash
            let cleanUrl = trimmedUrl.replace(/\/$/, '');
            
            // If it already ends with .git, return as is
            if (cleanUrl.endsWith('.git')) {
                return cleanUrl;
            }
            
            // For known providers without .git, add it
            if (this.isKnownProvider(cleanUrl)) {
                return cleanUrl + '.git';
            }
            
            // For self-hosted repos, check if it looks like a repository URL
            if (this.looksLikeRepositoryUrl(cleanUrl)) {
                return cleanUrl + '.git';
            }
            
            // Return as is for other patterns (might already be correct)
            return cleanUrl;
        }
        
        return trimmedUrl;
    }

    private static isKnownProvider(url: string): boolean {
        const knownProviders = [
            /^https?:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+$/,
            /^https?:\/\/gitlab\.com\/[\w\-\.]+\/[\w\-\.]+$/,
            /^https?:\/\/bitbucket\.org\/[\w\-\.]+\/[\w\-\.]+$/
        ];
        
        return knownProviders.some(pattern => pattern.test(url));
    }

    private static looksLikeRepositoryUrl(url: string): boolean {
        // Common patterns that indicate a repository URL that should have .git added
        const repoPatterns = [
            /^https?:\/\/[\w\-\.]+\/[\w\-\.]+\/[\w\-\.]+$/,           // domain.com/user/repo
            /^https?:\/\/[\w\-\.]+\/git\/[\w\-\.]+$/,                // domain.com/git/repo
            /^https?:\/\/[\w\-\.]+\/repos?\/[\w\-\.]+$/,             // domain.com/repo/name
            /^https?:\/\/[\w\-\.]+\/scm\/[\w\-\.]+$/,                // domain.com/scm/repo
            /^https?:\/\/[\w\-\.]+\/projects\/[\w\-\.]+$/            // domain.com/projects/repo
        ];
        
        return repoPatterns.some(pattern => pattern.test(url));
    }

    static extractRepositoryName(url: string): string {
        // Handle SSH URLs like git@domain:user/repo.git
        if (url.includes('@') && url.includes(':') && !url.includes('://')) {
            const sshMatch = url.match(/:([^\/]+\/)?([^\/]+?)(?:\.git)?$/);
            if (sshMatch) {
                return sshMatch[2];
            }
        }
        
        // Handle standard URLs
        const match = url.match(/\/([^\/]+?)(?:\.git)?(?:\/)?$/);
        if (match) {
            return match[1];
        }
        
        // Fallback: try to extract from any path-like structure
        const pathMatch = url.match(/([^\/\:]+?)(?:\.git)?$/);
        return pathMatch ? pathMatch[1] : 'repository';
    }

    static createRepository(url: string): GitRepository {
        return {
            url,
            name: this.extractRepositoryName(url),
            normalizedUrl: this.normalize(url)
        };
    }
}

class ProjectFileDetector {
    static detect(workspacePath: string): ProjectFileDetectionResult {
        try {
            const items = fs.readdirSync(workspacePath);
            const detectedFiles: string[] = [];
            
            // Check for common files
            for (const file of ProjectFilePatterns.COMMON_FILES) {
                if (items.includes(file)) {
                    detectedFiles.push(file);
                }
            }
            
            // Check for common directories
            for (const dir of ProjectFilePatterns.COMMON_DIRECTORIES) {
                if (items.includes(dir)) {
                    const fullPath = path.join(workspacePath, dir);
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.isDirectory()) {
                            detectedFiles.push(`${dir}/`);
                        }
                    } catch {
                        // Ignore stat errors and continue
                    }
                }
            }
            
            return {
                hasCommonFiles: detectedFiles.length > 0,
                detectedFiles
            };
        } catch (error) {
            console.error('Error detecting project files:', error);
            return {
                hasCommonFiles: true, // Default to safe behavior
                detectedFiles: []
            };
        }
    }
}

class CloneLocationResolver {
    static resolve(repository: GitRepository, workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): CloneLocation {
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return this.resolveForNoWorkspace(repository);
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const detection = ProjectFileDetector.detect(workspacePath);
        
        if (detection.hasCommonFiles) {
            return this.resolveForExistingProject(repository, workspacePath);
        } else {
            return this.resolveForCleanWorkspace(repository, workspacePath);
        }
    }

    private static resolveForNoWorkspace(repository: GitRepository): CloneLocation {
        const homedir = require('os').homedir();
        return {
            targetPath: path.join(homedir, repository.name),
            cloneToRoot: false,
            message: `Clone ${repository.name} to new folder in home directory?`
        };
    }

    private static resolveForExistingProject(repository: GitRepository, workspacePath: string): CloneLocation {
        let targetPath = path.join(workspacePath, repository.name);
        let counter = 1;
        
        while (fs.existsSync(targetPath)) {
            targetPath = path.join(workspacePath, `${repository.name}-${counter}`);
            counter++;
        }
        
        return {
            targetPath,
            cloneToRoot: false,
            message: `Cloning ${repository.name} to new folder (avoiding conflicts)`
        };
    }

    private static resolveForCleanWorkspace(repository: GitRepository, workspacePath: string): CloneLocation {
        return {
            targetPath: workspacePath,
            cloneToRoot: true,
            message: `Clone ${repository.name} contents to current workspace root? (No project files detected)`
        };
    }
}

class GitCloneService {
    static async clone(repository: GitRepository, location: CloneLocation, targetPath: string): Promise<CloneResult> {
        return new Promise<CloneResult>((resolve) => {
            const { gitArgs, workingDir } = this.prepareGitCommand(repository, location, targetPath);
            
            const gitProcess = cp.spawn('git', gitArgs, {
                cwd: workingDir,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let errorOutput = '';
            
            gitProcess.stdout?.on('data', (data) => {
                // Could be used for progress reporting in the future
            });
            
            gitProcess.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            gitProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(this.createSuccessResult(repository, location, targetPath));
                } else {
                    console.error('Git clone error:', errorOutput);
                    resolve({
                        success: false,
                        message: `Failed to clone repository: ${errorOutput || 'Unknown error'}`
                    });
                }
            });
            
            gitProcess.on('error', (error) => {
                console.error('Git process error:', error);
                resolve({
                    success: false,
                    message: `Failed to start git process: ${error.message}`
                });
            });
        });
    }

    private static prepareGitCommand(repository: GitRepository, location: CloneLocation, targetPath: string): { gitArgs: string[], workingDir: string } {
        if (location.cloneToRoot && targetPath === location.targetPath) {
            return {
                gitArgs: ['clone', repository.normalizedUrl, '.'],
                workingDir: targetPath
            };
        } else {
            return {
                gitArgs: ['clone', repository.normalizedUrl, path.basename(targetPath)],
                workingDir: path.dirname(targetPath)
            };
        }
    }

    private static createSuccessResult(repository: GitRepository, location: CloneLocation, targetPath: string): CloneResult {
        const message = location.cloneToRoot
            ? `Successfully cloned ${repository.name} to workspace root (no conflicts detected)`
            : `Successfully cloned ${repository.name} to new folder`;
            
        return {
            success: true,
            message,
            targetPath
        };
    }
}

class UserInteractionService {
    static async confirmCloneLocation(location: CloneLocation, repository: GitRepository): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const defaultPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : require('os').homedir();
        
        return vscode.window.showInputBox({
            prompt: location.message,
            value: location.targetPath,
            valueSelection: location.cloneToRoot ? undefined : [
                defaultPath.length + 1, 
                defaultPath.length + 1 + repository.name.length
            ]
        });
    }

    static async showCloneResult(result: CloneResult, location: CloneLocation): Promise<void> {
        if (!result.success) {
            vscode.window.showErrorMessage(result.message);
            return;
        }

        const action = location.cloneToRoot ? 'Reload Window' : 'Open Folder';
        
        const selection = await vscode.window.showInformationMessage(result.message, action);
        
        if (selection === 'Open Folder' && result.targetPath) {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.targetPath));
        } else if (selection === 'Reload Window') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}

// ================================
// Main Extension Components
// ================================

class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'glone.cloneFromClipboard';
    }

    updateForRepository(repository: GitRepository): void {
        this.statusBarItem.text = `$(repo-clone) Clone: ${repository.name}`;
        this.statusBarItem.tooltip = `Click to clone: ${repository.url}`;
        this.statusBarItem.show();
    }

    hide(): void {
        this.statusBarItem.hide();
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

class ClipboardMonitor {
    private timer?: NodeJS.Timeout;
    private readonly checkInterval = 1000;

    constructor(private onRepositoryDetected: (repo: GitRepository) => void, private onNoRepository: () => void) {}

    start(): void {
        this.checkClipboard();
        this.timer = setInterval(() => this.checkClipboard(), this.checkInterval);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private async checkClipboard(): Promise<void> {
        try {
            const clipboardText = await vscode.env.clipboard.readText();
            
            if (clipboardText && GitUrlValidator.isValid(clipboardText)) {
                const repository = GitUrlValidator.createRepository(clipboardText);
                this.onRepositoryDetected(repository);
            } else {
                this.onNoRepository();
            }
        } catch (error) {
            console.error('Error checking clipboard:', error);
            this.onNoRepository();
        }
    }
}

class GitCloneExtension {
    private statusBarManager: StatusBarManager;
    private clipboardMonitor: ClipboardMonitor;
    private currentRepository?: GitRepository;

    constructor() {
        this.statusBarManager = new StatusBarManager();
        this.clipboardMonitor = new ClipboardMonitor(
            (repo) => this.onRepositoryDetected(repo),
            () => this.onNoRepository()
        );
    }

    activate(context: vscode.ExtensionContext): void {
        console.log('Glone extension is now active');
        
        // Register command
        const cloneCommand = vscode.commands.registerCommand('glone.cloneFromClipboard', () => this.executeClone());
        
        // Start monitoring
        this.clipboardMonitor.start();
        
        // Register for cleanup
        context.subscriptions.push(
            cloneCommand,
            this.statusBarManager,
            { dispose: () => this.clipboardMonitor.stop() }
        );
    }

    deactivate(): void {
        this.clipboardMonitor.stop();
        this.statusBarManager.dispose();
    }

    private onRepositoryDetected(repository: GitRepository): void {
        this.currentRepository = repository;
        this.statusBarManager.updateForRepository(repository);
    }

    private onNoRepository(): void {
        this.currentRepository = undefined;
        this.statusBarManager.hide();
    }

    private async executeClone(): Promise<void> {
        try {
            // Get current repository from clipboard
            const clipboardText = await vscode.env.clipboard.readText();
            
            if (!clipboardText || !GitUrlValidator.isValid(clipboardText)) {
                vscode.window.showErrorMessage('No valid git repository URL found in clipboard');
                return;
            }

            const repository = GitUrlValidator.createRepository(clipboardText);
            
            // Resolve clone location
            const location = CloneLocationResolver.resolve(repository, vscode.workspace.workspaceFolders);
            
            // Confirm location with user
            const confirmedPath = await UserInteractionService.confirmCloneLocation(location, repository);
            
            if (!confirmedPath) {
                return; // User cancelled
            }

            // Execute clone with progress
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Cloning ${repository.name}...`,
                cancellable: false
            }, async () => {
                return GitCloneService.clone(repository, location, confirmedPath);
            });

            // Show result to user
            await UserInteractionService.showCloneResult(result, location);

        } catch (error) {
            console.error('Clone operation failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Clone failed: ${errorMessage}`);
        }
    }
}

// ================================
// Extension Entry Points
// ================================

let extensionInstance: GitCloneExtension;

export function activate(context: vscode.ExtensionContext): void {
    extensionInstance = new GitCloneExtension();
    extensionInstance.activate(context);
}

export function deactivate(): void {
    extensionInstance?.deactivate();
} 