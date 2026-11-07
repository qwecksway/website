using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AfastechAdminInstaller
{
    internal static class Installer
    {
        private const string ProductName = "AFASTECH Super Admin";
        private const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AfastechSuperAdmin";
        private static readonly string InstallDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AFASTECH", "SuperAdmin", "App");
        private static readonly string AppPath = Path.Combine(InstallDir, "AfastechSuperAdmin.exe");
        private static readonly string SetupPath = Path.Combine(InstallDir, "AfastechSuperAdminSetup.exe");
        private static readonly string DesktopShortcut = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ProductName + ".lnk");
        private static readonly string MenuShortcut = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), ProductName + ".lnk");
        private static readonly string[] Files = {
            "AfastechSuperAdmin.exe", "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "afastech.ico",
            "WebView2-LICENSE.txt", "WebView2-NOTICE.txt"
        };

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            try
            {
                if (args.Length == 1 && args[0] == "--uninstall")
                {
                    Uninstall();
                    return;
                }
                if (args.Length != 0) throw new ArgumentException("Unsupported installer option.");
                if (MessageBox.Show("Install AFASTECH Super Admin for your Windows account?\n\n" +
                    "The app requires 64-bit Windows 10/11, .NET Framework 4.6.2 or newer, " +
                    "an internet connection and Microsoft Edge WebView2 Runtime. " +
                    "It uses your existing Super Admin email and password.",
                    ProductName, MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
                Install();
                if (MessageBox.Show("Installation completed. A desktop icon and Start menu shortcut were created.\n\nOpen the app now?",
                    ProductName, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    Process.Start(AppPath);
            }
            catch (Exception ex)
            {
                MessageBox.Show("The operation could not be completed. Close the Super Admin app and try again.\n\n" + ex.Message,
                    ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.ExitCode = 1;
            }
        }

        private static void Install()
        {
            Directory.CreateDirectory(InstallDir);
            Assembly assembly = Assembly.GetExecutingAssembly();
            foreach (string file in Files)
            {
                using (Stream input = assembly.GetManifestResourceStream("Payload." + file))
                {
                    if (input == null) throw new InvalidDataException("Installer is missing " + file + ".");
                    using (FileStream output = new FileStream(Path.Combine(InstallDir, file), FileMode.Create, FileAccess.Write))
                        input.CopyTo(output);
                }
            }
            string currentSetup = Assembly.GetExecutingAssembly().Location;
            if (!String.Equals(currentSetup, SetupPath, StringComparison.OrdinalIgnoreCase))
                File.Copy(currentSetup, SetupPath, true);
            CreateShortcut(DesktopShortcut);
            CreateShortcut(MenuShortcut);
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RegistryPath))
            {
                if (key == null) throw new InvalidOperationException("Could not register the application for removal.");
                key.SetValue("DisplayName", ProductName);
                key.SetValue("Publisher", "Afadjato Senior High Technical School");
                key.SetValue("DisplayVersion", "1.0.0");
                key.SetValue("DisplayIcon", AppPath);
                key.SetValue("UninstallString", "\"" + SetupPath + "\" --uninstall");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void CreateShortcut(string path)
        {
            Type type = Type.GetTypeFromProgID("WScript.Shell");
            if (type == null) throw new InvalidOperationException("Windows shortcut support is unavailable.");
            dynamic shell = Activator.CreateInstance(type);
            dynamic shortcut = shell.CreateShortcut(path);
            shortcut.TargetPath = AppPath;
            shortcut.WorkingDirectory = InstallDir;
            shortcut.IconLocation = Path.Combine(InstallDir, "afastech.ico");
            shortcut.Description = ProductName;
            shortcut.Save();
        }

        private static void Uninstall()
        {
            if (MessageBox.Show("Remove the Super Admin app and its shortcuts?\n\n" +
                "Its browser sign-in data will remain on this Windows account. Sign out from the app first if needed.",
                ProductName, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            foreach (string file in Files)
            {
                string path = Path.Combine(InstallDir, file);
                if (File.Exists(path)) File.Delete(path);
            }
            if (File.Exists(DesktopShortcut)) File.Delete(DesktopShortcut);
            if (File.Exists(MenuShortcut)) File.Delete(MenuShortcut);
            Registry.CurrentUser.DeleteSubKey(RegistryPath, false);
            MessageBox.Show("The app and shortcuts were removed. The uninstaller and browser data remain in your local AFASTECH folder.",
                ProductName, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}
