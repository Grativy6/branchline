param([Parameter(Mandatory)][int]$OwnerPid, [ValidateSet('advance','download','cancel')][string]$Action)
$ErrorActionPreference = 'Stop'
# Test-only automation: only windows owned by this helper's still-running tree.
Add-Type @'
using System; using System.Collections.Generic; using System.Text;
using System.Runtime.InteropServices;
public static class DownloadTestWindows {
  public static HashSet<string> Seen=new HashSet<string>();
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string[] Click(int[] pids, string action) {
    var ids=new HashSet<int>(pids);var clicked=new List<string>();
    EnumWindows((h,l)=>{
      uint p;GetWindowThreadProcessId(h,out p);if(!ids.Contains((int)p))return true;
      var title=new StringBuilder(512);GetWindowText(h,title,512);
      bool fixture=title.ToString().Contains("TEST FIXTURE");
      EnumChildWindows(h,(c,x)=>{
        if(clicked.Count>0 || !IsWindowEnabled(c) || !IsWindowVisible(c))return true;
        var text=new StringBuilder(200);GetWindowText(c,text,200);
        var kind=new StringBuilder(100);GetClassName(c,kind,100);
        if(!kind.ToString().Contains("Button"))return true;
        var label=text.ToString().Replace("&","").Trim();
        Seen.Add(title.ToString()+" | "+label);
        bool choose=action=="cancel" ? (fixture && (label=="Cancel" || label=="Stop download")) || label=="Yes" :
          fixture && (label=="Next >" || label=="Next" || label=="Download" || label=="Finish");
        if(choose) {PostMessage(c,0xF5,IntPtr.Zero,IntPtr.Zero);clicked.Add(label);}
        return true;
      },IntPtr.Zero);return true;
    },IntPtr.Zero);
    return clicked.ToArray();
  }
}
'@
$taskTimer = [Diagnostics.Stopwatch]::StartNew()
$taskClicks = [Collections.Generic.List[string]]::new()
while ($taskTimer.Elapsed.TotalSeconds -lt 25) {
  if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { break }
  $taskIds = [Collections.Generic.List[int]]::new()
  $taskIds.Add($OwnerPid)
  $taskProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
  for ($taskPass=0; $taskPass -lt 4; $taskPass++) {
    foreach ($taskProcess in $taskProcesses) {
      if ($taskIds.Contains([int]$taskProcess.ParentProcessId) -and -not $taskIds.Contains([int]$taskProcess.ProcessId)) { $taskIds.Add([int]$taskProcess.ProcessId) }
    }
  }
  foreach ($taskClick in [DownloadTestWindows]::Click($taskIds.ToArray(), $Action)) { $taskClicks.Add($taskClick) }
  if ($taskClicks.Contains('Finish')) { break }
  if ($Action -eq 'download' -and $taskClicks.Contains('Download')) { break }
  Start-Sleep -Milliseconds 350
}
@{action=$Action;clicks=@($taskClicks);observed=@([DownloadTestWindows]::Seen)} | ConvertTo-Json -Compress
