using System.ComponentModel;
using System.Diagnostics;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Branchline.Preview;

// Fixed application operations. Program choices are made by the user and run
// with that user's Windows access; a working folder is NOT a filesystem sandbox.
internal static class WorkHost {
    private static SafeFileHandle? ownedJob;
    private static readonly StreamReader Input=new(Console.OpenStandardInput(),new UTF8Encoding(false,true));
    private static readonly object OutputGate=new();
    private static readonly StreamWriter Output=new(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true};
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits { public long PerProcessTime,PerJobTime;public uint LimitFlags;public UIntPtr MinimumWorkingSet,MaximumWorkingSet;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits { public BasicLimits Basic;public IoCounters Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateJobObject(IntPtr a,string? n);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool SetInformationJobObject(SafeFileHandle job,int c,ref ExtendedLimits info,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool AssignProcessToJobObject(SafeFileHandle job,IntPtr process);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback,IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent,EnumWindow callback,IntPtr data);
    private delegate bool EnumWindow(IntPtr window,IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr h,StringBuilder s,int count);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr h,StringBuilder s,int count);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr h,int index);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool GetWindowRect(IntPtr h,out Rect r);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,StringBuilder data,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr SendText(IntPtr h,uint message,IntPtr w,string data,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)] private static extern IntPtr SendButton(IntPtr h,uint message,IntPtr w,IntPtr data,uint flags,uint timeout,out UIntPtr result);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left,Top,Right,Bottom; }
    private record WindowInfo(string handle,int processId,string started,string executable,string title);
    private record ControlInfo(string id,string kind,string text,bool enabled,int x,int y,int width,int height);
    private record WindowView(WindowInfo target,List<ControlInfo> controls,string revision);
    private static void Emit(object value){lock(OutputGate){Output.WriteLine(JsonSerializer.Serialize(value));Output.Flush();}}
    private static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static string Property(JsonElement p,string name)=>p.GetProperty(name).GetString()??throw new IOException("Missing "+name);
    private static string Handle(IntPtr h)=>h.ToInt64().ToString("x");
    private static IntPtr ParseHandle(string h)=>new(Convert.ToInt64(h,16));
    private static string Class(IntPtr h) {var s=new StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString();}
    private static string Caption(IntPtr h){var s=new StringBuilder(1024);GetWindowText(h,s,s.Capacity);return s.ToString();}
    private static WindowInfo Describe(IntPtr h){
        if(!IsWindow(h)||GetAncestor(h,2)!=h||GetWindowThreadProcessId(h,out var pid)==0)throw new IOException("The selected window is gone.");
        using var p=Process.GetProcessById((int)pid);var executable=p.MainModule?.FileName??throw new IOException("Window owner is unavailable.");
        if(string.Equals(executable,Environment.ProcessPath,StringComparison.OrdinalIgnoreCase))throw new IOException("Branchline cannot grant itself control of its own settings.");
        return new(Handle(h),(int)pid,p.StartTime.ToUniversalTime().Ticks.ToString(),Path.GetFullPath(executable),Caption(h));
    }
    private static WindowInfo Check(JsonElement expected){var actual=Describe(ParseHandle(Property(expected,"handle")));if(actual.processId!=expected.GetProperty("processId").GetInt32()||actual.started!=Property(expected,"started")||!actual.executable.Equals(Property(expected,"executable"),StringComparison.OrdinalIgnoreCase))throw new IOException("The window owner changed. Select it again.");return actual;}
    private static WindowView Inspect(WindowInfo info){
        var h=ParseHandle(info.handle);if(!GetWindowRect(h,out var bounds))throw new IOException("Window bounds unavailable.");
        var controls=new List<ControlInfo>();
        EnumChildWindows(h,(child,ignored)=>{
            if(controls.Count>=200)return false;
            GetWindowThreadProcessId(child,out var pid);if(pid!=info.processId||!IsWindowVisible(child))return true;
            var kind=Class(child);string text=Caption(child);bool password=kind.Contains("edit",StringComparison.OrdinalIgnoreCase)&&(GetWindowLongPtr(child,-16).ToInt64()&0x20)!=0;
            if(password)text="[password field]";
            else if(kind.Contains("edit",StringComparison.OrdinalIgnoreCase)){var s=new StringBuilder(4097);if(SendMessageTimeout(child,0x000D,(IntPtr)s.Capacity,s,2,500,out _)!=IntPtr.Zero)text=s.ToString();}
            GetWindowRect(child,out var r);controls.Add(new(Handle(child),kind,text,IsWindowEnabled(child),r.Left-bounds.Left,r.Top-bounds.Top,r.Right-r.Left,r.Bottom-r.Top));return true;
        },IntPtr.Zero);
        return new(info,controls,Hash(JsonSerializer.SerializeToUtf8Bytes(new {target=info,controls})));
    }
    private static object WindowAction(JsonElement request){
        string operation=Property(request,"operation");
        if(operation=="windows") {var windows=new List<WindowInfo>();EnumWindows((h,ignored)=>{if(windows.Count>=64)return false;if(IsWindowVisible(h)&&Caption(h).Length>0){try{windows.Add(Describe(h));}catch{}}return true;},IntPtr.Zero);return new {windows};}
        var info=Check(request.GetProperty("target"));var h=ParseHandle(info.handle);var view=Inspect(info);
        if(operation=="inspect_window")return view;
        if(operation=="capture_window"){
            if(!GetWindowRect(h,out var r))throw new IOException("Window bounds unavailable.");int width=r.Right-r.Left,height=r.Bottom-r.Top;
            if(width<1||height<1||width>4096||height>4096||(long)width*height>12000000)throw new IOException("The selected window exceeds the capture limit.");
            using var bitmap=new Bitmap(width,height);using(var graphics=Graphics.FromImage(bitmap)){var dc=graphics.GetHdc();try{if(!PrintWindow(h,dc,0))throw new IOException("This window did not provide a picture. No other screen area was captured.");}finally{graphics.ReleaseHdc(dc);}}
            Check(request.GetProperty("target"));using var data=new MemoryStream();bitmap.Save(data,ImageFormat.Png);
            return new {target=info,revision=view.revision,width,height,mimeType="image/png",base64=Convert.ToBase64String(data.ToArray()),method="PrintWindow_selected_window_only"};
        }
        if(Property(request,"revision")!=view.revision)throw new IOException("The window changed. Inspect it again before acting.");
        string controlId=Property(request,"controlId");var control=view.controls.SingleOrDefault(c=>c.id==controlId)??throw new IOException("Choose a visible control from this window.");
        if(!control.enabled)throw new IOException("The control is disabled.");var child=ParseHandle(controlId);
        if(GetAncestor(child,2)!=h||GetWindowThreadProcessId(child,out var owner)==0||owner!=info.processId)throw new IOException("The control changed owners.");
        ConfirmAction(new {operation,target=info,revision=view.revision,controlId});
        if(Inspect(Check(request.GetProperty("target"))).revision!=view.revision)throw new IOException("The window changed before the action.");
        if(operation=="set_window_text"){
            string text=Property(request,"text");if(text.Length>4000||text.Contains('\0')||!control.kind.Contains("edit",StringComparison.OrdinalIgnoreCase)||control.text=="[password field]")throw new IOException("Only ordinary native text fields are supported.");
            if(SendText(child,0x000C,IntPtr.Zero,text,2,2000,out _)==IntPtr.Zero)throw new IOException("The field did not accept the text message.");
        }else if(operation=="invoke_window_control"){
            if(!control.kind.Contains("button",StringComparison.OrdinalIgnoreCase))throw new IOException("Only native buttons support this action.");
            if(SendButton(child,0x00F5,IntPtr.Zero,IntPtr.Zero,2,2000,out _)==IntPtr.Zero)throw new IOException("The button did not accept the action message.");
        }else throw new IOException("Unsupported window operation.");
        Check(request.GetProperty("target"));return new {messageDelivered=true,observed=Inspect(Describe(h))};
    }
    private static void ConfirmAction(object detail){
        Emit(new {prepared=true,detail});
        if(Input.ReadLine()!="RUN")throw new IOException("The operation stopped before execution.");
    }
    private static void OwnProcessTree(){
        ownedJob=CreateJobObject(IntPtr.Zero,null);if(ownedJob.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits=new ExtendedLimits{Basic=new BasicLimits{LimitFlags=0x2000}};
        if(!SetInformationJobObject(ownedJob,9,ref limits,(uint)Marshal.SizeOf<ExtendedLimits>())||!AssignProcessToJobObject(ownedJob,Process.GetCurrentProcess().Handle))throw new Win32Exception(Marshal.GetLastWin32Error());
        // This fresh helper joins before starting any child. No pre-existing
        // process is assigned. The non-inherited job handle stays here until exit.
    }
    private static async Task<object> RunCommand(JsonElement r){
        if(Property(r,"mode")!="approved_windows_command")throw new IOException("Choose a deliberately approved command.");
        string executable=Path.GetFullPath(Property(r,"executable")),cwd=Path.GetFullPath(Property(r,"cwd"));
        if(!executable.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(executable)||!Directory.Exists(cwd))throw new IOException("Choose an existing executable and working folder.");
        using var image=PcFiles.HoldExecutable(executable,Property(r,"sha256"));
        using var working=PcFiles.HoldWorkingDirectory(cwd,Property(r,"cwdIdentity"));
        var args=r.GetProperty("args").EnumerateArray().Select(x=>x.GetString()??throw new IOException("Arguments must be text.")).ToArray();
        if(args.Length>32||args.Any(a=>a.Length>4000||a.Contains('\0')))throw new IOException("Command arguments exceeded their bound.");
        int seconds=r.GetProperty("seconds").GetInt32();if(seconds<1||seconds>600)throw new IOException("Choose a runtime between 1 and 600 seconds.");
        if(Property(r,"operation")=="inspect_command")return new {available=true,executable,args,cwd,seconds,filesystemIsolation=false};
        ConfirmAction(new {operation="run_command",executable,args,cwd,seconds,filesystemIsolation=false});
        OwnProcessTree();
        var start=new ProcessStartInfo(executable){WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
        foreach(string arg in args)start.ArgumentList.Add(arg);
        start.Environment.Clear();foreach(string key in new[]{"SYSTEMROOT","SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","PATH","PATHEXT","APPDATA","LOCALAPPDATA"})if(Environment.GetEnvironmentVariable(key) is string v)start.Environment[key]=v;
        start.Environment["PYTHONUTF8"]="1";
        using var child=Process.Start(start)??throw new IOException("The command did not start.");child.StandardInput.Close();
        var stdout=new StringBuilder();var stderr=new StringBuilder();using var timer=new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
        async Task Read(StreamReader reader,StringBuilder result,int max){char[] buffer=new char[2048];while(true){int n=await reader.ReadAsync(buffer.AsMemory(),timer.Token);if(n==0)return;if(result.Length+n>max){timer.Cancel();throw new IOException("Command output exceeded its limit.");}result.Append(buffer,0,n);Emit(new {progress=true,stream=ReferenceEquals(result,stdout)?"stdout":"stderr",text=new string(buffer,0,n)});}}
        var watch=Stopwatch.StartNew();bool finished=false;string? problem=null;
        try{await Task.WhenAll(Read(child.StandardOutput,stdout,64000),Read(child.StandardError,stderr,16000),child.WaitForExitAsync(timer.Token));finished=true;}catch(Exception e){problem=e is OperationCanceledException?"Command timed out; its owned process tree is being stopped.":e.Message;}
        return new {completed=finished,exitCode=finished?child.ExitCode:(int?)null,stdout=stdout.ToString(),stderr=stderr.ToString(),elapsedMs=watch.ElapsedMilliseconds,problem,pid=child.Id,execution="approved_windows_user_command",filesystemIsolation=false,cleanup="private_job_kill_on_helper_exit"};
    }
    internal static void Run(){
        try{string line=Input.ReadLine()??throw new IOException("No work request.");if(line.Length>40000)throw new IOException("Work request exceeded its limit.");using var doc=JsonDocument.Parse(line);var r=doc.RootElement;string operation=Property(r,"operation");object result=(operation=="run_command"||operation=="inspect_command")?RunCommand(r).GetAwaiter().GetResult():WindowAction(r);Emit(new {ok=true,value=result});}
        catch(Exception e){Emit(new {ok=false,error=e.Message});Environment.ExitCode=1;}
        Output.Flush();GC.KeepAlive(ownedJob);
        // Kernel handle cleanup on process exit owns descendant cleanup. This
        // helper never kills unrelated processes by a discovered name or PID.
    }
}
