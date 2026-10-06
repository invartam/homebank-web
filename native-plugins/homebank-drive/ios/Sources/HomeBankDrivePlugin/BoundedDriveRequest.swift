import Foundation

// A completion-handler data task buffers the entire response before a size check.
final class BoundedDriveRequest: NSObject, URLSessionDataDelegate {
    private let maxBytes: Int
    private let completion: (Data?, URLResponse?, Error?) -> Void
    private var data = Data()
    private var response: URLResponse?
    private var oversized = false
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    init(maxBytes: Int, completion: @escaping (Data?, URLResponse?, Error?) -> Void) {
        self.maxBytes = maxBytes
        self.completion = completion
    }
    func start(_ request: URLRequest) { session.dataTask(with: request).resume() }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        self.response = response
        oversized = response.expectedContentLength > Int64(maxBytes)
        completionHandler(oversized ? .cancel : .allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        guard !oversized else { return }
        if chunk.count > maxBytes - data.count { oversized = true; dataTask.cancel(); return }
        data.append(chunk)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let failure = oversized ? NSError(domain: NSURLErrorDomain, code: NSURLErrorDataLengthExceedsMaximum) : error
        completion(oversized ? nil : data, response, failure)
        session.finishTasksAndInvalidate()
    }
}
