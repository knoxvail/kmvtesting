<?php
// Inquiry form endpoint: relays the message to info@triadsl.com.
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo '{"ok":false}'; exit; }

function field($k, $max) {
  $v = isset($_POST[$k]) ? trim($_POST[$k]) : '';
  $v = str_replace(array("\r", "\n", "%0a", "%0d"), ' ', $v);
  return mb_substr($v, 0, $max);
}

// Honeypot: real visitors never fill this field.
if (!empty($_POST['website'])) { echo '{"ok":true}'; exit; }

$name    = field('name', 120);
$company = field('company', 160);
$email   = field('email', 200);
$message = isset($_POST['message']) ? mb_substr(trim($_POST['message']), 0, 5000) : '';

if ($name === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
  http_response_code(400); echo '{"ok":false}'; exit;
}

$to      = 'info@triadsl.com';
$subject = 'Website inquiry from ' . $name;
$body    = "Name: $name\nCompany: " . ($company !== '' ? $company : '-') . "\nEmail: $email\n\n$message\n";
$headers = "From: Triad Senior Living <inquiry@triadsl.com>\r\nReply-To: $email";

$sent = mail($to, $subject, $body, $headers, '-finquiry@triadsl.com');
echo $sent ? '{"ok":true}' : '{"ok":false}';
