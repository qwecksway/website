using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AfastechAdmin
{
    internal static class Program
    {
        internal const string PortalOrigin = "https://afastechshs-afastech.vercel.app";
        internal const string LoginUrl = PortalOrigin + "/portal-admin.html";
        private static CoreWebView2Environment environment;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs args)
            {
                MessageBox.Show("The administrator app encountered an error:\n" + args.Exception.Message,
                    "AFASTECH Super Admin", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            Application.Run(new PortalWindow(false));
        }

        internal static async Task<CoreWebView2Environment> GetEnvironment()
        {
            if (environment == null)
            {
                string dataPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AFASTECH", "SuperAdmin", "BrowserData");
                environment = await CoreWebView2Environment.CreateAsync(null, dataPath);
            }
            return environment;
        }

        internal static bool IsPortal(string address)
        {
            Uri uri;
            return Uri.TryCreate(address, UriKind.Absolute, out uri)
                && uri.Scheme == Uri.UriSchemeHttps
                && uri.Host.Equals("afastechshs-afastech.vercel.app", StringComparison.OrdinalIgnoreCase)
                && uri.IsDefaultPort;
        }

        internal static void OpenExternal(string address)
        {
            Uri uri;
            if (!Uri.TryCreate(address, UriKind.Absolute, out uri)
                || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeMailto
                    && uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != "tel"))
            {
                throw new InvalidOperationException("The link uses an unsupported address.");
            }
            Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
        }
    }

    internal sealed class PortalWindow : Form
    {
        private readonly WebView2 browser;
        private readonly bool popup;

        internal PortalWindow(bool isPopup)
        {
            popup = isPopup;
            Text = "AFASTECH Super Admin";
            Width = 1280;
            Height = 820;
            MinimumSize = new Size(640, 480);
            StartPosition = FormStartPosition.CenterScreen;
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "afastech.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
            browser = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(browser);
            if (!popup) Shown += async delegate { await OpenPortal(); };
        }

        private async Task OpenPortal()
        {
            try
            {
                await InitializeBrowser();
                browser.CoreWebView2.Navigate(Program.LoginUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not start the portal. Make sure Microsoft Edge WebView2 Runtime is installed and try again.\n\n" +
                    "Download the runtime from https://developer.microsoft.com/microsoft-edge/webview2/\n\n" + ex.Message,
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private async Task InitializeBrowser()
        {
            await browser.EnsureCoreWebView2Async(await Program.GetEnvironment());
            browser.CoreWebView2.NavigationStarting += NavigationStarting;
            browser.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                    MessageBox.Show("The portal could not be loaded. Check your internet connection and try again.\n\n" +
                        "Error: " + e.WebErrorStatus, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            browser.CoreWebView2.NewWindowRequested += NewWindowRequested;
        }

        private void NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (Program.IsPortal(e.Uri) || (popup && e.Uri == "about:blank")) return;
            e.Cancel = true;
            try { Program.OpenExternal(e.Uri); }
            catch (Exception ex)
            {
                MessageBox.Show("The link could not be opened:\n" + ex.Message, Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private async void NewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            CoreWebView2Deferral deferral = e.GetDeferral();
            try
            {
                if (!String.IsNullOrEmpty(e.Uri) && e.Uri != "about:blank" && !Program.IsPortal(e.Uri))
                {
                    e.Handled = true;
                    Program.OpenExternal(e.Uri);
                    return;
                }
                PortalWindow child = new PortalWindow(true);
                try
                {
                    await child.InitializeBrowser();
                    e.NewWindow = child.browser.CoreWebView2;
                    e.Handled = true;
                    child.Show(this);
                }
                catch
                {
                    child.Dispose();
                    throw;
                }
            }
            catch (Exception ex)
            {
                e.Handled = true;
                MessageBox.Show("The new window could not be opened:\n" + ex.Message, Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally { deferral.Complete(); }
        }
    }
}
