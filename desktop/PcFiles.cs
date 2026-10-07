using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Branchline.Preview;

// Typed file operations only. No shell, native UI messages, or general-purpose invocation.
internal static class PcFiles
{
    private const uint Read = 0x80000000, Write = 0x40000000;
    private const uint Reparse = 0x400, DirectoryFlag = 0x10;
    private const int MaxBytes = 1024 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);
    [StructLayout(LayoutKind.Sequential)] private struct Info {
        public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME created, accessed, written;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);

    private sealed class Lease : IDisposable {
        public readonly List<SafeFileHandle> Handles = new();
        public SafeFileHandle Last => Handles[^1];
        public Info Info => GetInfo(Last);
        public void Dispose() { for (int i = Handles.Count - 1; i >= 0; i--) Handles[i].Dispose(); }
    }
    private static Info GetInfo(SafeFileHandle h) {
        if (!GetFileInformationByHandle(h, out var info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return info;
    }
    private static string Identity(Info i) => $"{i.volume:x8}:{i.indexHigh:x8}{i.indexLow:x8}";
    private static bool Under(string value, string parent) => value.Equals(parent, StringComparison.OrdinalIgnoreCase) || value.StartsWith(parent.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
    private static string Absolute(string value) {
        if (value.Length > 220 || value.Length < 4 || !char.IsAsciiLetter(value[0]) || value[1] != ':' || value[2] != '\\' || value.Contains('/') || value[3..].Contains(':')) throw new IOException("Choose a normal local path, without device names, streams or network shares.");
        var parts = value[3..].Split('\\');
        foreach (var part in parts) CheckPart(part);
        return char.ToUpperInvariant(value[0]) + value[1..];
    }
    private static void CheckPart(string part) {
        if (part.Length == 0 || part is "." or ".." || part.EndsWith(' ') || part.EndsWith('.') || part.Any(c => c < 32 || "<>:\"/\\|?*".Contains(c))) throw new IOException("Use a bounded relative path with ordinary file names.");
        string stem = part.Split('.')[0].ToUpperInvariant();
        if (stem is "CON" or "PRN" or "AUX" or "NUL" or "CONIN$" or "CONOUT$" || System.Text.RegularExpressions.Regex.IsMatch(stem, @"^(COM|LPT)[0-9¹²³]$")) throw new IOException("Device paths are unavailable.");
    }
    private static string Relative(string root, string relative) {
        if (relative == "") return root;
        if (relative.Length > 180 || relative.Contains('/') || relative.Contains(':')) throw new IOException("Use a relative path within the selected folder.");
        foreach (var p in relative.Split('\\')) CheckPart(p);
        return Absolute(root + "\\" + relative);
    }
    private static Lease Open(string path, bool directory, bool write = false) {
        path = Absolute(path); var lease = new Lease();
        try {
            // Keep every ancestor open without FILE_SHARE_DELETE. A checked junction or
            // ancestor cannot be substituted before the final handle is used.
            var pieces = path[3..].Split('\\'); string current = path[..3];
            for (int i = -1; i < pieces.Length; i++) {
                if (i >= 0) current = Path.Combine(current, pieces[i]);
                bool last = i == pieces.Length - 1;
                var h = CreateFile(current, last && !directory ? Read | (write ? Write : 0) : 0x80, last && !directory ? 0u : 3u,
                    IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                if (h.IsInvalid) { h.Dispose(); throw new IOException("The location is unavailable or busy. Close its editor or review this folder."); }
                lease.Handles.Add(h); var info = GetInfo(h);
                if ((info.attributes & Reparse) != 0 || (info.attributes & 0x400000) != 0) throw new IOException("Links and cloud placeholders are unavailable in this file profile.");
                if ((!last || directory) != ((info.attributes & DirectoryFlag) != 0)) throw new IOException("The target type changed. Review this location.");
                if ((info.attributes & DirectoryFlag) == 0 && info.links != 1) throw new IOException("Multiply-linked files are unavailable.");
                var final = new StringBuilder(512); uint count = GetFinalPathNameByHandle(h, final, 512, 0);
                if (count == 0 || count >= 512 || !final.ToString().Equals("\\\\?\\" + current.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) && !final.ToString().Equals("\\\\?\\" + current, StringComparison.OrdinalIgnoreCase)) throw new IOException("An alias or remapped location needs review.");
            }
            return lease;
        } catch { lease.Dispose(); throw; }
    }
    private static string Text(JsonElement e, string name) => e.GetProperty(name).GetString() ?? throw new IOException("A text field is required.");
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static byte[] Bytes(SafeFileHandle h) {
        var info = GetInfo(h); if (info.sizeHigh != 0 || info.sizeLow > MaxBytes) throw new IOException("This file exceeds the 1 MiB text limit.");
        byte[] bytes = new byte[info.sizeLow]; int offset = 0;
        while (offset < bytes.Length) { int count = RandomAccess.Read(h, bytes.AsSpan(offset), offset); if (count == 0) throw new IOException("The file changed while reading."); offset += count; }
        return bytes;
    }
    private static string Decode(byte[] bytes) { string value = Utf8.GetString(bytes); if (value.Contains('\0')) throw new IOException("This is not supported UTF-8 text."); return value; }
    private static void SaveNew(string file, byte[] data) {
        using var handle = CreateFile(file, Read | Write, 0, IntPtr.Zero, 1, 0x00200000, IntPtr.Zero);
        if (handle.IsInvalid) throw new IOException("The new file already exists or cannot be created.");
        RandomAccess.Write(handle, data, 0); RandomAccess.FlushToDisk(handle);
    }
    internal static void Run() {
        try {
            using var input = new StreamReader(Console.OpenStandardInput(), Utf8);
            string? line = input.ReadLine(); if (line is null || line.Length > 1600000) throw new IOException("Invalid file request.");
            using var doc = JsonDocument.Parse(line); var request = doc.RootElement;
            object result = Execute(request, input);
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, value = result }));
        } catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = error.Message })); Environment.ExitCode = 1; }
    }
    private static object Execute(JsonElement p, StreamReader input) {
        string mode = Text(p, "mode");
        if (mode == "inspect") {
            string location = Absolute(Text(p, "path")); bool directory = p.GetProperty("directory").GetBoolean();
            using var target = Open(location, directory);
            return new { path = location, identity = Identity(target.Info), directory };
        }
        if (mode is not ("list" or "read" or "search" or "create" or "replace")) throw new IOException("Unsupported file operation.");
        string root = Absolute(Text(p, "root")); var held = new List<Lease>();
        try {
            var rootLease = Open(root, true); held.Add(rootLease);
            if (Identity(rootLease.Info) != Text(p, "rootIdentity")) throw new IOException("The selected folder changed identity. Review its permission.");
            var denied = p.GetProperty("denied").EnumerateArray().Select(x => Text(x, "path")).ToArray();
            foreach (var exclusion in p.GetProperty("denied").EnumerateArray()) {
                if (!exclusion.TryGetProperty("identity", out var expected)) continue; // fixed internal paths, possibly absent
                var lease = Open(Text(exclusion, "path"), exclusion.GetProperty("directory").GetBoolean()); held.Add(lease);
                if (Identity(lease.Info) != expected.GetString()) throw new IOException("An excluded location changed. Review Do not access before continuing.");
            }
            bool Denied(string s) => denied.Any(d => Under(s, d));
            string targetPath = Relative(root, Text(p, "path"));
            if (Denied(targetPath)) throw new IOException("That location is excluded.");
            if (mode == "list") {
                using var target = Open(targetPath, true); var entries = new List<object>(); int inspected = 0;
                foreach (var file in System.IO.Directory.EnumerateFileSystemEntries(targetPath)) {
                    if (++inspected > 4096) throw new IOException("This directory exceeds the listing limit. Choose a smaller folder.");
                    if (Denied(file)) continue;
                    try {
                        var attributes = File.GetAttributes(file); bool directory = (attributes & FileAttributes.Directory) != 0;
                        using var child = Open(file, directory); entries.Add(new { name = Path.GetFileName(file), directory });
                    } catch (IOException) { /* Names behind unsupported or denied objects are not disclosed. */ }
                }
                int offset = p.GetProperty("offset").GetInt32(); if (offset < 0 || offset > entries.Count) throw new IOException("Invalid listing offset.");
                return new { items = entries.Skip(offset).Take(48), nextOffset = offset + 48 < entries.Count ? (int?)(offset + 48) : null, total = entries.Count };
            }
            if (mode == "create") {
                using var parent = Open(Path.GetDirectoryName(targetPath)!, true);
                byte[] bytes = Utf8.GetBytes(Text(p, "text")); if (bytes.Length > MaxBytes) throw new IOException("Text exceeds the file limit.");
                Console.WriteLine("{\"prepared\":true}"); Console.Out.Flush();
                if (input.ReadLine() != "COMMIT") throw new IOException("The change was cancelled before creation.");
                SaveNew(targetPath, bytes);
                using var saved = Open(targetPath, false);
                if (Hash(Bytes(saved.Last)) != Hash(bytes)) throw new IOException("The created file changed before verification. Inspect it before retrying.");
                return new { created = true, sha256 = Hash(bytes), identity = Identity(saved.Info), bytes = bytes.Length };
            }
            using var fileLease = Open(targetPath, false, mode == "replace"); byte[] original = Bytes(fileLease.Last);
            string content = Decode(original); string hash = Hash(original); string identity = Identity(fileLease.Info);
            if (mode is "read" or "search") {
                int offset = p.GetProperty("offset").GetInt32(); if (offset < 0 || offset > content.Length || offset > 0 && offset < content.Length && char.IsLowSurrogate(content[offset])) throw new IOException("Invalid text offset.");
                if (mode == "search") {
                    string query = Text(p, "query"); if (query.Length is < 1 or > 200) throw new IOException("Use a short literal search.");
                    int match = content.IndexOf(query, offset, StringComparison.Ordinal); return new { sha256 = hash, identity, matchOffset = match, nextOffset = match < 0 ? (int?)null : match + query.Length };
                }
                int end = Math.Min(content.Length, offset + 4000); if (end < content.Length && char.IsHighSurrogate(content[end - 1])) end--;
                return new { text = content[offset..end], offset, nextOffset = end < content.Length ? (int?)end : null, characters = content.Length, bytes = original.Length, encoding = "UTF-8", sha256 = hash, identity };
            }
            if (hash != Text(p, "sha256") || identity != Text(p, "identity")) throw new IOException("The file changed. Read it again before editing.");
            string old = Text(p, "oldText"), replacement = Text(p, "text"); int at = content.IndexOf(old, StringComparison.Ordinal);
            if (old.Length == 0 || at < 0 || content.IndexOf(old, at + old.Length, StringComparison.Ordinal) >= 0) throw new IOException("The old passage must match exactly once.");
            byte[] changed = Utf8.GetBytes(content[..at] + replacement + content[(at + old.Length)..]); if (changed.Length > MaxBytes) throw new IOException("The edited file exceeds the text limit.");
            string recovery = Absolute(Text(p, "recovery")); using var recoveryLease = Open(recovery, true);
            string operation = Text(p, "operationId"); if (!System.Text.RegularExpressions.Regex.IsMatch(operation, "^[a-f0-9]{32}$")) throw new IOException("Invalid recovery identity.");
            SaveNew(Path.Combine(recovery, operation + ".original"), original);
            SaveNew(Path.Combine(recovery, operation + ".json"), Utf8.GetBytes(JsonSerializer.Serialize(new { path = targetPath, identity, before = hash, after = Hash(changed), status = "PREPARED", recovery = operation + ".original" })));
            Console.WriteLine(JsonSerializer.Serialize(new { prepared = true, recoveryId = operation, before = hash, after = Hash(changed) })); Console.Out.Flush();
            if (input.ReadLine() != "COMMIT") throw new IOException("The edit was cancelled; the original is unchanged.");
            // The exclusive target handle prevents replacement or competing writes. An
            // interrupted in-place write is recoverable, not described as atomic.
            RandomAccess.Write(fileLease.Last, changed, 0); RandomAccess.SetLength(fileLease.Last, changed.Length); RandomAccess.FlushToDisk(fileLease.Last);
            if (Hash(Bytes(fileLease.Last)) != Hash(changed)) throw new IOException("Verification failed. Inspect the recovery copy before retrying.");
            return new { edited = true, sha256 = Hash(changed), identity, bytes = changed.Length, recoveryId = operation };
        } finally { foreach (var lease in held.AsEnumerable().Reverse()) lease.Dispose(); }
    }
}
