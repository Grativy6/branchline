using System.Runtime.InteropServices;
using Microsoft.Win32;
namespace Branchline.Preview;

internal static class WindowBackdrop
{
    [StructLayout(LayoutKind.Sequential)] private struct Margins { public int Left, Right, Top, Bottom; }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref Margins margins);
    internal static bool Supported => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621);
    internal static bool EnabledBySystem
    {
        get {
            if (SystemInformation.HighContrast) return false;
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("EnableTransparency") is not int value || value != 0;
        }
    }
    internal static bool Apply(Form window, bool requested)
    {
        if (!Supported) return false;
        bool enabled = requested && EnabledBySystem;
        int backdrop = enabled ? 3 : 1; // Desktop Acrylic / none. Windows 11 22621+.
        var margins = new Margins { Left = enabled ? -1 : 0, Right = enabled ? -1 : 0, Top = enabled ? -1 : 0, Bottom = enabled ? -1 : 0 };
        if (DwmSetWindowAttribute(window.Handle, 38, ref backdrop, sizeof(int)) != 0) return false;
        if (DwmExtendFrameIntoClientArea(window.Handle, ref margins) != 0) return false;
        window.BackColor = enabled ? Color.Black : Color.FromArgb(244, 242, 234);
        return enabled;
    }
}
