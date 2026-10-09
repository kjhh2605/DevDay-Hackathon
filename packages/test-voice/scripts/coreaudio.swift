// Test-only CoreAudio device routing. Build with: swiftc coreaudio.swift -o coreaudio
import Foundation
import CoreAudio

let system = AudioObjectID(kAudioObjectSystemObject)
func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func check(_ status: OSStatus) throws {
    if status != noErr { throw NSError(domain: "CoreAudio", code: Int(status)) }
}
func defaultDevice(_ selector: AudioObjectPropertySelector) throws -> AudioDeviceID {
    var a = address(selector), value = AudioDeviceID(0), size = UInt32(MemoryLayout<AudioDeviceID>.size)
    try check(AudioObjectGetPropertyData(system, &a, 0, nil, &size, &value))
    return value
}
func setDefault(_ selector: AudioObjectPropertySelector, _ id: AudioDeviceID) throws {
    var a = address(selector), value = id
    try check(AudioObjectSetPropertyData(system, &a, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &value))
    if try defaultDevice(selector) != id { throw NSError(domain: "CoreAudio readback mismatch", code: 1) }
}
do {
    let args = CommandLine.arguments
    if args.count == 4 && args[1] == "set", let input = UInt32(args[2]), let output = UInt32(args[3]) {
        try setDefault(kAudioHardwarePropertyDefaultInputDevice, input)
        try setDefault(kAudioHardwarePropertyDefaultOutputDevice, output)
    } else if args.count != 1 {
        throw NSError(domain: "Usage: coreaudio [set INPUT_ID OUTPUT_ID]", code: 1)
    }
    var a = address(kAudioHardwarePropertyDevices), size: UInt32 = 0
    try check(AudioObjectGetPropertyDataSize(system, &a, 0, nil, &size))
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    try check(AudioObjectGetPropertyData(system, &a, 0, nil, &size, &ids))
    var devices: [[String: Any]] = []
    for id in ids {
        var name: Unmanaged<CFString>?
        var n = address(kAudioObjectPropertyName), nsize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        try check(AudioObjectGetPropertyData(id, &n, 0, nil, &nsize, &name))
        devices.append(["id": id, "name": name?.takeUnretainedValue() as String? ?? "Unknown"])
    }
    let result: [String: Any] = ["devices": devices,
        "defaultInput": try defaultDevice(kAudioHardwarePropertyDefaultInputDevice),
        "defaultOutput": try defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)]
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
