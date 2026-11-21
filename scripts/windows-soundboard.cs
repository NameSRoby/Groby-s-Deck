// Disk-streamed, per-endpoint playback. No capture or system volume changes.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace Groby.Soundboard {
  public static class Player {
    sealed class Voice : IDisposable {
      public string Clip;
      public string Group;
      public MMDevice Device;
      public MediaFoundationReader Reader;
      public WasapiOut Output;
      public void Dispose() {
        if (Output != null) { Output.Stop(); Output.Dispose(); }
        if (Reader != null) Reader.Dispose();
        if (Device != null) Device.Dispose();
      }
    }
    static readonly List<Voice> voices = new List<Voice>();
    static string lastError = "";
    static string Key(string id) {
      using (var hash = SHA256.Create()) return "device:" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(id))).Replace("-", "").ToLowerInvariant();
    }
    static void Sweep() {
      foreach (var voice in voices.ToArray()) {
        if (voice.Output.PlaybackState == PlaybackState.Stopped) { voices.Remove(voice); voice.Dispose(); }
      }
    }
    public static object Status() {
      Sweep();
      var devices = new List<object>();
      using (var enumerator = new MMDeviceEnumerator()) {
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)) {
          using (device) devices.Add(new { key = Key(device.ID), name = device.FriendlyName });
        }
      }
      return new { available = true, outputs = devices, playing = voices.Select(v => v.Clip).ToArray(), error = lastError };
    }
    public static object Stop(string clip) {
      foreach (var voice in voices.Where(v => clip == "" || v.Clip == clip).ToArray()) { voices.Remove(voice); voice.Dispose(); }
      return new { ok = true };
    }
    static void StopGroup(string group) {
      foreach (var voice in voices.Where(v => v.Group == group).ToArray()) { voices.Remove(voice); voice.Dispose(); }
    }
    public static object Play(string clip, string file, string[] outputs, int volume, string mode) {
      Sweep(); lastError = "";
      string group = clip + "|" + String.Join("|", outputs.OrderBy(value => value));
      if (mode == "toggle" && voices.Any(v => v.Group == group)) { StopGroup(group); return new { ok = true }; }
      var prepared = new List<Voice>();
      var selected = new HashSet<string>();
      try {
        foreach (var output in outputs) {
          var voice = new Voice { Clip = clip, Group = group }; prepared.Add(voice);
          using (var enumerator = new MMDeviceEnumerator()) {
            if (output == "default") voice.Device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            else {
              foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)) {
                if (Key(device.ID) == output && voice.Device == null) voice.Device = device;
                else device.Dispose();
              }
            }
          }
          if (voice.Device == null) throw new Exception("soundboard_output_unavailable");
          // Default and a named endpoint may refer to the same physical output.
          if (!selected.Add(voice.Device.ID)) { prepared.Remove(voice); voice.Dispose(); continue; }
          voice.Reader = new MediaFoundationReader(file);
          if (voice.Reader.TotalTime.TotalMinutes > 30) throw new Exception("soundboard_duration_limit");
          var samples = new SampleChannel(voice.Reader, false) { Volume = volume / 100f };
          voice.Output = new WasapiOut(voice.Device, AudioClientShareMode.Shared, true, 80);
          voice.Output.PlaybackStopped += (sender, args) => { if (args.Exception != null) lastError = "soundboard_playback_failed"; };
          voice.Output.Init(new SampleToWaveProvider(samples));
        }
        int remaining = voices.Count - (mode == "restart" ? voices.Count(v => v.Group == group) : 0);
        if (remaining + prepared.Count > 8) throw new Exception("soundboard_playback_busy");
        if (mode == "restart") StopGroup(group);
        foreach (var voice in prepared) voice.Output.Play();
        voices.AddRange(prepared);
        return new { ok = true, durationSeconds = prepared[0].Reader.TotalTime.TotalSeconds, outputs = prepared.Count };
      } catch { foreach (var voice in prepared) voice.Dispose(); throw; }
    }
  }
}
